import { 
  ExtendedWebSocket, 
  PriceUpdateMessage, 
  MarketMoversUpdateMessage,
  TrendingUpdateMessage,
  AISignalMessage,
  WebSocketEventType
} from './types';
import { getStockQuote, getMarketMovers, yahooFinanceInstance } from '../services/yahooFinance';
import { storeStockQuote, storeMarketMovers, getHistoricalData as getDbHistoricalData } from '../services/clickhouse';
import { generateAISignal, type MarketData } from '../services/ai-strategies';
import { isSubscribedToEvent, isSubscribedToSymbol } from './handlers';

// Popular symbols to track
const POPULAR_SYMBOLS = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'META', 'NFLX'];

// AI signal strategies to rotate
const AI_STRATEGIES = ['neuro-scalp', 'quantum-momentum', 'deep-value', 'sentiment-fusion'];

// Broadcast real-time price updates and market movers
export class PriceBroadcaster {
  private clients: Set<ExtendedWebSocket>;
  private priceUpdateCounter: number = 0;
  private aiSignalCounter: number = 0;
  private trendingCounter: number = 0;
  private priceIntervalId: NodeJS.Timeout | null = null;
  private moversIntervalId: NodeJS.Timeout | null = null;
  private aiSignalIntervalId: NodeJS.Timeout | null = null;
  private trendingIntervalId: NodeJS.Timeout | null = null;

  constructor(clients: Set<ExtendedWebSocket>) {
    this.clients = clients;
  }

  start() {
    console.log(`[${new Date().toISOString()}] [Broadcaster] Starting real-time data broadcasting...`);

    // Price updates every 5 seconds
    this.priceIntervalId = setInterval(async () => {
      await this.broadcastPriceUpdates();
    }, 5000);

    // Market movers every 30 seconds
    this.moversIntervalId = setInterval(async () => {
      await this.broadcastMarketMovers();
    }, 30000);

    // AI signals every 15 seconds
    this.aiSignalIntervalId = setInterval(async () => {
      await this.broadcastAISignals();
    }, 15000);

    // Trending symbols every 60 seconds
    this.trendingIntervalId = setInterval(async () => {
      await this.broadcastTrending();
    }, 60000);

    // Initial broadcasts after short delay
    setTimeout(async () => {
      await this.broadcastMarketMovers();
      await this.broadcastTrending();
      await this.broadcastAISignals();
    }, 3000);

    console.log(`[${new Date().toISOString()}] [Broadcaster] Scheduled:
    - Price updates: every 5s
    - Market movers: every 30s
    - AI signals: every 15s
    - Trending: every 60s`);
  }

  stop() {
    if (this.priceIntervalId) clearInterval(this.priceIntervalId);
    if (this.moversIntervalId) clearInterval(this.moversIntervalId);
    if (this.aiSignalIntervalId) clearInterval(this.aiSignalIntervalId);
    if (this.trendingIntervalId) clearInterval(this.trendingIntervalId);
    
    this.priceIntervalId = null;
    this.moversIntervalId = null;
    this.aiSignalIntervalId = null;
    this.trendingIntervalId = null;

    console.log(`[${new Date().toISOString()}] [Broadcaster] Stopped`);
  }

  // Broadcast price updates to subscribed clients
  private async broadcastPriceUpdates() {
    const subscribedClients = this.getSubscribedClients('price_update');
    if (subscribedClients.length === 0) return;

    let updateCount = 0;

    for (const symbol of POPULAR_SYMBOLS) {
      try {
        const quote = await getStockQuote(symbol);
        const update: PriceUpdateMessage = {
          type: 'price_update',
          symbol: quote.symbol,
          price: quote.price || 0,
          change: quote.change || 0,
          changePercent: quote.changePercent || 0,
          volume: quote.volume || 0,
          marketCap: quote.marketCap,
          dayHigh: quote.dayHigh,
          dayLow: quote.dayLow,
          timestamp: Date.now()
        };

        // Send to clients subscribed to this symbol
        let sentCount = 0;
        subscribedClients.forEach(client => {
          if (isSubscribedToSymbol(client, symbol)) {
            client.send(JSON.stringify(update));
            sentCount++;
          }
        });

        if (sentCount > 0) {
          updateCount++;
          // Store in database
          storeStockQuote(quote).catch(() => {});
        }
      } catch (error: any) {
        // Silent fail for individual symbols
      }
    }

    if (updateCount > 0) {
      console.log(`[${new Date().toISOString()}] [Broadcaster] Price updates: ${updateCount} symbols to ${subscribedClients.length} clients`);
    }
  }

  // Broadcast market movers to subscribed clients
  private async broadcastMarketMovers() {
    const subscribedClients = this.getSubscribedClients('market_movers_update');
    if (subscribedClients.length === 0) return;

    try {
      const [gainers, losers] = await Promise.all([
        getMarketMovers('gainers', 20),
        getMarketMovers('losers', 20)
      ]);

      // Note: changePercent is already a percentage value (e.g., -11.85 for -11.85%)
      const update: MarketMoversUpdateMessage = {
        type: 'market_movers_update',
        gainers: gainers.map(g => ({
          symbol: g.symbol,
          name: g.name,
          price: g.price,
          change: `${g.changePercent >= 0 ? '+' : ''}${g.changePercent.toFixed(2)}%`,
          changePercent: g.changePercent,
          volume: g.volume ? `${(g.volume / 1000000).toFixed(1)}M` : undefined,
          currency: g.currency
        })),
        losers: losers.map(l => ({
          symbol: l.symbol,
          name: l.name,
          price: l.price,
          change: `${l.changePercent >= 0 ? '+' : ''}${l.changePercent.toFixed(2)}%`,
          changePercent: l.changePercent,
          volume: l.volume ? `${(l.volume / 1000000).toFixed(1)}M` : undefined,
          currency: l.currency
        })),
        timestamp: Date.now()
      };

      // Send to all subscribed clients
      subscribedClients.forEach(client => {
        client.send(JSON.stringify(update));
      });

      console.log(`[${new Date().toISOString()}] [Broadcaster] Market movers: ${gainers.length} gainers, ${losers.length} losers to ${subscribedClients.length} clients`);

      // Store in database
      Promise.all([
        storeMarketMovers('gainers', gainers),
        storeMarketMovers('losers', losers)
      ]).catch(() => {});

    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [Broadcaster] Market movers error:`, error.message);
    }
  }

  // Broadcast AI signals for popular symbols
  private async broadcastAISignals() {
    const subscribedClients = this.getSubscribedClients('ai_signal');
    if (subscribedClients.length === 0) return;

    // Rotate through symbols
    const symbolIndex = this.aiSignalCounter % POPULAR_SYMBOLS.length;
    const strategyIndex = this.aiSignalCounter % AI_STRATEGIES.length;
    const symbol = POPULAR_SYMBOLS[symbolIndex];
    const strategy = AI_STRATEGIES[strategyIndex];
    this.aiSignalCounter++;

    try {
      // Get historical data for analysis
      let historicalPrices: number[] = [];
      let currentPrice = 100;

      const historicalData = await getDbHistoricalData(symbol, 30);
      if (historicalData && Array.isArray(historicalData) && historicalData.length > 0) {
        historicalPrices = historicalData.map((d: any) => d.close || d.price || 0);
        currentPrice = historicalPrices[historicalPrices.length - 1] || 100;
      } else {
        // Generate realistic mock data
        historicalPrices = this.generateMockPrices(30);
        currentPrice = historicalPrices[historicalPrices.length - 1];
      }

      // Generate AI signal
      const marketData: MarketData = {
        symbol,
        price: currentPrice,
        volume: Math.floor(Math.random() * 10000000) + 1000000,
        historicalPrices,
        timestamp: Date.now()
      };

      const signal = generateAISignal(marketData, strategy, Math.random() * 0.4 - 0.2);

      // Calculate indicators
      const volatility = this.calculateVolatility(historicalPrices);
      const rsi = this.calculateRSI(historicalPrices);
      const sma20 = this.calculateSMA(historicalPrices, 20);
      const sma50 = historicalPrices.length >= 50 ? this.calculateSMA(historicalPrices, 50) : sma20;

      const aiSignalMessage: AISignalMessage = {
        type: 'ai_signal',
        signal: {
          symbol,
          action: signal.action,
          confidence: signal.confidence,
          reason: signal.reason,
          strategy,
          indicators: {
            rsi,
            sma20,
            sma50,
            volatility,
            macd: {
              value: (sma20 - sma50) / sma50 * 100,
              signal: 0,
              histogram: (sma20 - sma50) / sma50 * 100
            }
          },
          priceTarget: {
            entry: currentPrice,
            stopLoss: signal.action === 'BUY' 
              ? currentPrice * (1 - volatility * 2)
              : currentPrice * (1 + volatility * 2),
            takeProfit: signal.action === 'BUY'
              ? currentPrice * (1 + volatility * 3)
              : currentPrice * (1 - volatility * 3)
          }
        },
        timestamp: Date.now()
      };

      // Send to clients subscribed to this symbol or all symbols
      let sentCount = 0;
      subscribedClients.forEach(client => {
        if (isSubscribedToSymbol(client, symbol)) {
          client.send(JSON.stringify(aiSignalMessage));
          sentCount++;
        }
      });

      if (sentCount > 0) {
        console.log(`[${new Date().toISOString()}] [Broadcaster] AI signal: ${symbol} ${signal.action} (${signal.confidence.toFixed(1)}%) using ${strategy} to ${sentCount} clients`);
      }

    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [Broadcaster] AI signal error for ${symbol}:`, error.message);
    }
  }

  // Broadcast trending symbols
  private async broadcastTrending() {
    const subscribedClients = this.getSubscribedClients('trending_update');
    if (subscribedClients.length === 0) return;

    try {
      const trending = await yahooFinanceInstance.trendingSymbols('US', { count: 20 });

      if (trending?.quotes && trending.quotes.length > 0) {
        const trendingUpdate: TrendingUpdateMessage = {
          type: 'trending_update',
          symbols: trending.quotes.map((quote: any, index: number) => ({
            symbol: quote.symbol,
            name: quote.shortName || quote.longName || quote.symbol,
            rank: index + 1,
            price: quote.regularMarketPrice,
            changePercent: quote.regularMarketChangePercent
          })),
          timestamp: Date.now()
        };

        // Send to all subscribed clients
        subscribedClients.forEach(client => {
          client.send(JSON.stringify(trendingUpdate));
        });

        console.log(`[${new Date().toISOString()}] [Broadcaster] Trending: ${trending.quotes.length} symbols to ${subscribedClients.length} clients`);
      }
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [Broadcaster] Trending error:`, error.message);
    }
  }

  // Helper: Get clients subscribed to an event
  private getSubscribedClients(event: WebSocketEventType): ExtendedWebSocket[] {
    const subscribed: ExtendedWebSocket[] = [];
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && isSubscribedToEvent(client, event)) {
        subscribed.push(client);
      }
    });
    return subscribed;
  }

  // Helper: Generate mock prices
  private generateMockPrices(count: number): number[] {
    const prices: number[] = [];
    let price = 100 + Math.random() * 100;
    for (let i = 0; i < count; i++) {
      price = price * (1 + (Math.random() - 0.5) * 0.04);
      prices.push(price);
    }
    return prices;
  }

  // Helper: Calculate volatility
  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0.02;
    
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }
    }
    
    if (returns.length === 0) return 0.02;
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance) || 0.02;
  }

  // Helper: Calculate RSI
  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // Helper: Calculate SMA
  private calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;
    
    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }
}
