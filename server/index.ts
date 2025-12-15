import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
// import { registerAuthRoutes, setupAuth } from "./auth";
import { serveStatic } from "./static";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import yahooFinance from 'yahoo-finance2';

// Initialize Yahoo Finance API
const yahooFinanceInstance = new yahooFinance();

// Extended WebSocket interface with symbols property
interface ExtendedWebSocket extends WebSocket {
  symbols?: string[];
}

const app = express();
const httpServer = createServer(app);

// Setup authentication
// setupAuth(app);

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set<ExtendedWebSocket>();

wss.on('connection', (ws: ExtendedWebSocket) => {
  console.log('Client connected');
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'subscribe' && data.symbols) {
        ws.symbols = data.symbols;
        console.log(`Client subscribed to: ${data.symbols.join(', ')}`);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
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

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app, yahooFinanceInstance);
  // registerAuthRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

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
    },
  );
})();
