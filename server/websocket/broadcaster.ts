import { ExtendedWebSocket, PriceUpdateMessage, MarketMoversUpdateMessage } from './types';
import { getStockQuote, getMarketMovers } from '../services/yahooFinance';
import { storeStockQuote, storeMarketMovers } from '../services/clickhouse';

// Broadcast real-time price updates and market movers
export class PriceBroadcaster {
  private clients: Set<ExtendedWebSocket>;
  private updateCounter: number = 0;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(clients: Set<ExtendedWebSocket>) {
    this.clients = clients;
  }

  start() {
    this.intervalId = setInterval(async () => {
      await this.broadcastUpdates();
    }, 5000); // Update every 5 seconds
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async broadcastUpdates() {
    if (this.clients.size === 0) {
      console.log(`[${new Date().toISOString()}] No WebSocket clients connected, skipping updates`);
      return;
    }

    console.log(`[${new Date().toISOString()}] Broadcasting updates to ${this.clients.size} client(s)`);

    try {
      // Get popular symbols for individual price updates (every 5 seconds)
      const popularSymbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA', 'AMZN'];
      let updateCount = 0;

      // Send individual price updates for popular symbols
      for (const symbol of popularSymbols) {
        try {
          const quote = await getStockQuote(symbol);
          const update: PriceUpdateMessage = {
            type: 'price_update',
            symbol: quote.symbol,
            price: quote.price,
            change: quote.change,
            changePercent: quote.changePercent,
            volume: quote.volume,
            timestamp: Date.now()
          };

          // Send to all clients subscribed to this symbol
          let sentCount = 0;
          this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN &&
                (!client.symbols || client.symbols.includes(symbol))) {
              client.send(JSON.stringify(update));
              sentCount++;
            }
          });

          updateCount++;
          console.log(`[${new Date().toISOString()}] Updated ${symbol}: $${quote.price?.toFixed(2)} (${quote.changePercent?.toFixed(2)}%) - sent to ${sentCount} client(s)`);

          // Store stock quote in ClickHouse (non-blocking)
          storeStockQuote({
            symbol: quote.symbol,
            price: quote.price || 0,
            change: quote.change || 0,
            changePercent: quote.changePercent || 0,
            volume: quote.volume || 0,
            marketCap: quote.marketCap || null,
            peRatio: quote.peRatio || null,
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
      this.updateCounter++;
      if (this.updateCounter >= 6) {
        this.updateCounter = 0;
        await this.broadcastMarketMovers();
      }

      console.log(`[${new Date().toISOString()}] Update cycle completed: ${updateCount}/${popularSymbols.length} symbols updated`);

    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error in update broadcast:`, error);
    }
  }

  private async broadcastMarketMovers() {
    try {
      console.log(`[${new Date().toISOString()}] Fetching market movers...`);

      const [gainers, losers] = await Promise.all([
        getMarketMovers('gainers', 20),
        getMarketMovers('losers', 20)
      ]);

      const marketMoversUpdate: MarketMoversUpdateMessage = {
        type: 'market_movers_update',
        gainers,
        losers,
        timestamp: Date.now()
      };

      // Send market movers to all connected clients
      let moversSentCount = 0;
      this.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(marketMoversUpdate));
          moversSentCount++;
        }
      });

      console.log(`[${new Date().toISOString()}] Market movers updated: ${gainers.length} gainers, ${losers.length} losers - sent to ${moversSentCount} client(s)`);

      // Store market movers in ClickHouse (non-blocking)
      Promise.all([
        storeMarketMovers('gainers', gainers),
        storeMarketMovers('losers', losers)
      ]).catch((storageError: any) => {
        // Silently fail if ClickHouse is not available
        console.debug(`[${new Date().toISOString()}] ClickHouse storage failed for market movers (non-critical):`, storageError.message);
      });

    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] Error fetching market movers:`, error.message);
    }
  }
}