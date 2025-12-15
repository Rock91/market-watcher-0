import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
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

// Extended WebSocket interface with symbols property
interface ExtendedWebSocket extends WebSocket {
  symbols?: string[];
}

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(express.json());
app.use(requestLogger);

// Setup authentication
// setupAuth(app);

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set<ExtendedWebSocket>();
let priceBroadcaster: PriceBroadcaster;

// WebSocket connection handling
wss.on('connection', (ws: ExtendedWebSocket) => {
  handleConnection(ws, clients);
});

// Broadcast real-time price updates and market movers
let updateCounter = 0;
setInterval(async () => {
  if (clients.size === 0) {
    console.log(`[${new Date().toISOString()}] No WebSocket clients connected, skipping updates`);
    return;
  }

  console.log(`[${new Date().toISOString()}] Broadcasting updates to ${clients.size} client(s)`);

  try {
    // Get popular symbols for individual price updates (every 5 seconds)
    const popularSymbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA', 'AMZN'];
    let updateCount = 0;

    // Send individual price updates for popular symbols
    for (const symbol of popularSymbols) {
      try {
        const quote: any = await yahooFinanceInstance.quote(symbol);
        const update = {
          type: 'price_update',
          symbol: quote.symbol,
          price: quote.regularMarketPrice,
          change: quote.regularMarketChange,
          changePercent: quote.regularMarketChangePercent,
          volume: quote.regularMarketVolume,
          timestamp: Date.now()
        };

        // Send to all clients subscribed to this symbol
        let sentCount = 0;
        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN &&
              (!client.symbols || client.symbols.includes(symbol))) {
            client.send(JSON.stringify(update));
            sentCount++;
          }
        });

        updateCount++;
        console.log(`[${new Date().toISOString()}] Updated ${symbol}: $${quote.regularMarketPrice?.toFixed(2)} (${quote.regularMarketChangePercent?.toFixed(2)}%) - sent to ${sentCount} client(s)`);

        // Store stock quote in ClickHouse (non-blocking)
        storeStockQuote({
          symbol: quote.symbol,
          price: quote.regularMarketPrice || 0,
          change: quote.regularMarketChange || 0,
          changePercent: quote.regularMarketChangePercent || 0,
          volume: quote.regularMarketVolume || 0,
          marketCap: quote.marketCap || null,
          peRatio: quote.trailingPE || null,
          timestamp: new Date()
        }).catch((storageError: any) => {
          // Silently fail if ClickHouse is not available
          console.debug(`[${new Date().toISOString()}] ClickHouse storage failed for ${symbol} (non-critical):`, storageError.message);
        });

      } catch (error: any) {
        console.error(`[${new Date().toISOString()}] Error updating ${symbol}:`, error.message);
      }
    }

    // Update market movers every 30 seconds (every 6th update)
    updateCounter++;
    if (updateCounter >= 6) {
      updateCounter = 0;

      // Get and broadcast top 20 gainers and losers
      try {
        console.log(`[${new Date().toISOString()}] Fetching market movers...`);

        const [gainersData, losersData] = await Promise.all([
          yahooFinanceInstance.screener({ scrIds: 'day_gainers', count: 20 }),
          yahooFinanceInstance.screener({ scrIds: 'day_losers', count: 20 })
        ]);

        const gainers = gainersData?.quotes?.slice(0, 20).map((quote: any) => ({
          symbol: quote.symbol,
          name: quote.shortName || quote.longName || '',
          price: quote.regularMarketPrice || 0,
          change: quote.regularMarketChangePercent
            ? `${quote.regularMarketChangePercent >= 0 ? '+' : ''}${(quote.regularMarketChangePercent * 100).toFixed(2)}%`
            : '0.00%',
          changePercent: quote.regularMarketChangePercent || 0
        })) || [];

        const losers = losersData?.quotes?.slice(0, 20).map((quote: any) => ({
          symbol: quote.symbol,
          name: quote.shortName || quote.longName || '',
          price: quote.regularMarketPrice || 0,
          change: quote.regularMarketChangePercent
            ? `${quote.regularMarketChangePercent >= 0 ? '+' : ''}${(quote.regularMarketChangePercent * 100).toFixed(2)}%`
            : '0.00%',
          changePercent: quote.regularMarketChangePercent || 0
        })) || [];

        const marketMoversUpdate = {
          type: 'market_movers_update',
          gainers: gainers,
          losers: losers,
          timestamp: Date.now()
        };

        // Send market movers to all connected clients
        let moversSentCount = 0;
        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(marketMoversUpdate));
            moversSentCount++;
          }
        });

        console.log(`[${new Date().toISOString()}] Market movers updated: ${gainers.length} gainers, ${losers.length} losers - sent to ${moversSentCount} client(s)`);

        // Store market movers in ClickHouse (non-blocking)
        storeMarketMovers(gainers, losers).catch((storageError: any) => {
          // Silently fail if ClickHouse is not available
          console.debug(`[${new Date().toISOString()}] ClickHouse storage failed for market movers (non-critical):`, storageError.message);
        });

      } catch (error: any) {
        console.error(`[${new Date().toISOString()}] Error fetching market movers:`, error.message);
      }
    }

    console.log(`[${new Date().toISOString()}] Update cycle completed: ${updateCount}/${popularSymbols.length} symbols updated`);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error in update broadcast:`, error);
  }
}, 5000); // Update every 5 seconds

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

  // Initialize price broadcaster
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
  initializeClickHouse().catch((error) => {
    console.warn(`[${new Date().toISOString()}] ClickHouse initialization failed (server will continue without database):`, error.message);
  });

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 3001 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "3001", 10);
  httpServer.listen(
    {
      port,
      host: "localhost",
    },
    () => {
      log(`[${new Date().toISOString()}] Market Watcher server started on port ${port}`);
      log(`[${new Date().toISOString()}] WebSocket server ready for connections`);
      log(`[${new Date().toISOString()}] Real-time price updates enabled (5-second intervals)`);
      log(`[${new Date().toISOString()}] Yahoo Finance API integration active`);
      log(`[${new Date().toISOString()}] ClickHouse database initialized`);
    },
  );
})();
