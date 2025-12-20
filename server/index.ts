import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";

// Import organized modules
import apiRoutes from './api/routes';
import { handleConnection } from './websocket/handlers';
import { PriceBroadcaster } from './websocket/broadcaster';
import { ExtendedWebSocket } from './websocket/types';
import { requestLogger, errorHandler } from './middleware';
import { serveStatic } from "./static";
import { initializeClickHouse } from './services/clickhouse';
import { log } from './utils/helpers';
import { startDataFetcher } from './jobs/dataFetcher';
import { startMarketDataSync } from './scripts/marketDataSync';
import { startIndicatorsSync } from './scripts/technicalIndicatorsSync';

const app = express();
const httpServer = createServer(app);

// CORS middleware - allow requests from client
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.CLIENT_URL || 'http://localhost:3000'
    : true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json());
app.use(requestLogger);

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set<ExtendedWebSocket>();
let priceBroadcaster: PriceBroadcaster;

// WebSocket connection handling
wss.on('connection', (ws: ExtendedWebSocket) => {
  handleConnection(ws, clients);
});

// Log WebSocket client count periodically
setInterval(() => {
  if (clients.size > 0) {
    log(`[${new Date().toISOString()}] Active WebSocket clients: ${clients.size}`);
  }
}, 60000); // Every minute

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

(async () => {
  // Register API routes
  app.use('/api', apiRoutes);

  // Error handling middleware
  app.use(errorHandler);

  // Initialize price broadcaster (handles all real-time data streaming)
  priceBroadcaster = new PriceBroadcaster(clients);
  priceBroadcaster.start();

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Initialize ClickHouse database (non-blocking)
  initializeClickHouse()
    .then(() => {
      // Start background data fetcher after ClickHouse is ready
      startDataFetcher();
      log(`[${new Date().toISOString()}] Background data fetcher started`);
      
      // Start market data sync service
      startMarketDataSync()
        .then(() => {
          log(`[${new Date().toISOString()}] Market data sync service started`);
        })
        .catch((error) => {
          console.warn(`[${new Date().toISOString()}] Market data sync failed to start:`, error.message);
        });
      
      // Start technical indicators sync service
      startIndicatorsSync()
        .then(() => {
          log(`[${new Date().toISOString()}] Technical indicators sync service started`);
        })
        .catch((error) => {
          console.warn(`[${new Date().toISOString()}] Technical indicators sync failed to start:`, error.message);
        });
    })
    .catch((error) => {
      console.warn(`[${new Date().toISOString()}] ClickHouse initialization failed (server will continue without database):`, error.message);
      // Still start the data fetcher - it will gracefully handle DB unavailability
      startDataFetcher();
      
      // Try to start market data sync even if ClickHouse init failed
      startMarketDataSync()
        .then(() => {
          log(`[${new Date().toISOString()}] Market data sync service started`);
        })
        .catch((syncError) => {
          console.warn(`[${new Date().toISOString()}] Market data sync failed to start:`, syncError.message);
        });
      
      // Try to start technical indicators sync even if ClickHouse init failed
      startIndicatorsSync()
        .then(() => {
          log(`[${new Date().toISOString()}] Technical indicators sync service started`);
        })
        .catch((syncError) => {
          console.warn(`[${new Date().toISOString()}] Technical indicators sync failed to start:`, syncError.message);
        });
    });

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 3000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "3000", 10);
  httpServer.listen(
    {
      port,
      host: "localhost",
    },
    () => {
      log(`[${new Date().toISOString()}] Market Watcher server started on port ${port}`);
      log(`[${new Date().toISOString()}] WebSocket server ready for real-time updates`);
      log(`[${new Date().toISOString()}] Broadcasting: prices(5s), movers(30s), AI signals(15s), trending(60s)`);
      log(`[${new Date().toISOString()}] Yahoo Finance API integration active`);
      log(`[${new Date().toISOString()}] Background data fetcher active - data cached in ClickHouse`);
      log(`[${new Date().toISOString()}] Market data sync active - movers(60s), historical backfill(10min)`);
      log(`[${new Date().toISOString()}] Technical indicators sync active - RSI/MACD/Volatility (1hr)`);
    },
  );
})();
