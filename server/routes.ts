import type { Express } from "express";
import { createServer, type Server } from "http";
import yahooFinance from 'yahoo-finance2';
import { storage } from "./storage";
import { generateAISignal, type MarketData } from "./ai-strategies";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  yahooFinance: any
): Promise<Server> {
  // put application routes here
  // prefix all routes with /api

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  // Yahoo Finance API Routes

  // Get stock quote
  app.get('/api/stocks/:symbol/quote', async (req, res) => {
    const { symbol } = req.params;
    console.log(`[${new Date().toISOString()}] Fetching quote for symbol: ${symbol}`);

    try {
      const quote: any = await yahooFinance.quote(symbol);
      console.log(`[${new Date().toISOString()}] Quote fetched successfully for ${symbol}: $${quote.regularMarketPrice?.toFixed(2)}`);

      // Format the response
      const formattedQuote = {
        symbol: quote.symbol,
        name: quote.shortName || quote.longName || '',
        price: quote.regularMarketPrice || 0,
        change: quote.regularMarketChange || 0,
        changePercent: quote.regularMarketChangePercent || 0,
        volume: quote.regularMarketVolume || 0,
        marketCap: quote.marketCap || 0,
        peRatio: quote.trailingPE || 0,
        dayHigh: quote.regularMarketDayHigh || 0,
        dayLow: quote.regularMarketDayLow || 0,
        previousClose: quote.regularMarketPreviousClose || 0,
        currency: quote.currency || 'USD'
      };

      console.log(`[${new Date().toISOString()}] Returning formatted quote for ${symbol}`);
      res.json(formattedQuote);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error fetching stock quote for ${symbol}:`, error);
      res.status(500).json({ error: 'Failed to fetch stock quote' });
    }
  });

  // Get historical data
  app.get('/api/stocks/:symbol/history', async (req, res) => {
    try {
      const { symbol } = req.params;
      const { period1, period2, interval = '5m' } = req.query;

      const queryOptions = {
        period1: period1 ? new Date(period1 as string) : new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        period2: period2 ? new Date(period2 as string) : new Date(),
        interval: interval as any,
      };

      const history: any = await yahooFinance.historical(symbol, queryOptions);

      // Format the response for the chart
      const formattedHistory = history.map((item: any) => ({
        time: new Date(item.date).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: false
        }),
        price: item.close,
        open: item.open,
        high: item.high,
        low: item.low,
        volume: item.volume
      }));

      res.json(formattedHistory);
    } catch (error) {
      console.error('Error fetching historical data:', error);
      // Fallback to generated data
      const fallbackData = [];
      let price = 100; // Base price
      for (let i = 0; i < 20; i++) {
        price = price * (1 + (Math.random() * 0.04 - 0.02));
        fallbackData.push({
          time: `${9 + Math.floor(i/2)}:${i % 2 === 0 ? '00' : '30'}`,
          price: price,
          open: price * 0.99,
          high: price * 1.01,
          low: price * 0.98,
          volume: Math.floor(Math.random() * 1000000)
        });
      }
      res.json(fallbackData);
    }
  });

  // Get market movers (gainers/losers)
  app.get('/api/market/movers/:type', async (req, res) => {
    const { type } = req.params; // 'gainers' or 'losers'
    const { count = 20 } = req.query;

    try {

      console.log(`[${new Date().toISOString()}] Fetching ${type} market movers, count: ${count}`);

      // Get trending symbols first
      const trending: any = await yahooFinance.trendingSymbols('en-us', { count: parseInt(count as string) * 3 });
      console.log(`[${new Date().toISOString()}] Trending symbols fetched:`, trending.symbols?.length || 0);

      // Get quotes for trending symbols
      const symbols = trending.symbols?.slice(0, parseInt(count as string) * 2) || [];
      console.log(`[${new Date().toISOString()}] Symbols to fetch quotes for:`, symbols.length);

      if (symbols.length === 0) {
        console.log(`[${new Date().toISOString()}] No symbols found, returning empty array`);
        return res.json([]);
      }

      // Get quotes for these symbols
      const quotesPromises = symbols.map((symbol: any) => yahooFinance.quote(symbol.symbol || symbol));
      const quotes = await Promise.allSettled(quotesPromises);

      console.log(`[${new Date().toISOString()}] Quotes fetched: ${quotes.filter(q => q.status === 'fulfilled').length} successful, ${quotes.filter(q => q.status === 'rejected').length} failed`);

      // Filter successful quotes and format data
      const validQuotes = quotes
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value)
        .filter(quote => quote && quote.symbol && quote.regularMarketPrice)
        .map(quote => ({
          symbol: quote.symbol,
          name: quote.shortName || quote.longName || '',
          price: quote.regularMarketPrice || 0,
          change: quote.regularMarketChangePercent
            ? `${quote.regularMarketChangePercent >= 0 ? '+' : ''}${(quote.regularMarketChangePercent * 100).toFixed(2)}%`
            : '0.00%',
          vol: quote.regularMarketVolume
            ? `${(quote.regularMarketVolume / 1000000).toFixed(1)}M`
            : 'N/A',
          currency: quote.currency || 'USD'
        }));

      // Sort by change percentage and filter by type
      const sortedQuotes = validQuotes.sort((a, b) => {
        const aChange = parseFloat(a.change);
        const bChange = parseFloat(b.change);
        return type === 'gainers' ? bChange - aChange : aChange - bChange;
      });

      const result = sortedQuotes.slice(0, parseInt(count as string));
      console.log(`[${new Date().toISOString()}] Returning ${result.length} ${type} results:`, result.map(r => `${r.symbol}: ${r.change}`));

      // Return top results
      res.json(result);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error fetching market movers:`, error);
      console.log(`[${new Date().toISOString()}] Falling back to mock data for ${type}`);
      // Fallback to mock data
      const mockGainers = [
        { symbol: "NVDA", name: "NVIDIA Corp", price: 145.32, change: "+12.4%", vol: "45M" },
        { symbol: "AMD", name: "Adv Micro Dev", price: 178.90, change: "+8.2%", vol: "22M" },
        { symbol: "PLTR", name: "Palantir Tech", price: 24.50, change: "+7.8%", vol: "18M" },
      ];
      const mockLosers = [
        { symbol: "INTC", name: "Intel Corp", price: 30.12, change: "-8.4%", vol: "30M" },
        { symbol: "WBA", name: "Walgreens Boots", price: 18.45, change: "-7.2%", vol: "10M" },
        { symbol: "LULU", name: "Lululemon", price: 290.50, change: "-6.8%", vol: "5M" },
      ];
      res.json(type === 'gainers' ? mockGainers : mockLosers);
    }
  });

  // Get trending symbols
  app.get('/api/market/trending', async (req, res) => {
    const { count = 20 } = req.query;
    console.log(`[${new Date().toISOString()}] Fetching trending symbols, count: ${count}`);

    try {
      const trending: any = await yahooFinance.trendingSymbols('en-us', { count: parseInt(count as string) });
      console.log(`[${new Date().toISOString()}] Trending symbols fetched successfully: ${trending.symbols?.length || 0} symbols`);
      res.json(trending);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error fetching trending symbols:`, error);
      res.status(500).json({ error: 'Failed to fetch trending symbols' });
    }
  });

  // Get market summary
  app.get('/api/market/summary', async (req, res) => {
    try {
      // Get major indices
      const indices = ['^GSPC', '^IXIC', '^DJI', '^RUT']; // S&P 500, NASDAQ, Dow Jones, Russell 2000
      const quotesPromises = indices.map(symbol => yahooFinance.quote(symbol));
      const quotes: PromiseSettledResult<any>[] = await Promise.allSettled(quotesPromises);

      const summary = quotes
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map((result, index) => {
          const quote = result.value;
          const names = ['S&P 500', 'NASDAQ', 'Dow Jones', 'Russell 2000'];
          return {
            symbol: indices[index],
            name: names[index],
            price: quote.regularMarketPrice || 0,
            change: quote.regularMarketChangePercent
              ? `${quote.regularMarketChangePercent >= 0 ? '+' : ''}${(quote.regularMarketChangePercent * 100).toFixed(2)}%`
              : '0.00%'
          };
        });

      res.json(summary);
    } catch (error) {
      console.error('Error fetching market summary:', error);
      // Fallback to mock data
      const summary = [
        { symbol: '^GSPC', name: 'S&P 500', price: 4200.50, change: '+0.8%' },
        { symbol: '^IXIC', name: 'NASDAQ', price: 12800.75, change: '+1.2%' },
        { symbol: '^DJI', name: 'Dow Jones', price: 33500.25, change: '+0.5%' }
      ];
      res.json(summary);
    }
  });

  // AI Signal Generation Endpoint
  app.post('/api/ai/signal', async (req, res) => {
    try {
      const { symbol, price, volume, historicalPrices, strategy, sentimentScore } = req.body;

      const marketData: MarketData = {
        symbol,
        price,
        volume,
        historicalPrices,
        timestamp: Date.now()
      };

      const signal = generateAISignal(marketData, strategy, sentimentScore || 0);
      res.json(signal);
    } catch (error) {
      console.error('Error generating AI signal:', error);
      res.status(500).json({ error: 'Failed to generate AI signal' });
    }
  });

  return httpServer;
}
