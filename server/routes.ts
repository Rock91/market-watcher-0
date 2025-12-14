import type { Express } from "express";
import { createServer, type Server } from "http";
import yahooFinance from 'yahoo-finance2';
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // put application routes here
  // prefix all routes with /api

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  // Yahoo Finance API Routes

  // Get stock quote
  app.get('/api/stocks/:symbol/quote', async (req, res) => {
    try {
      const { symbol } = req.params;
      const quote = await yahooFinance.quote(symbol);
      res.json(quote);
    } catch (error) {
      console.error('Error fetching stock quote:', error);
      res.status(500).json({ error: 'Failed to fetch stock quote' });
    }
  });

  // Get historical data
  app.get('/api/stocks/:symbol/history', async (req, res) => {
    try {
      const { symbol } = req.params;
      const { period1, period2, interval = '1d' } = req.query;

      const queryOptions = {
        period1: period1 ? new Date(period1 as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        period2: period2 ? new Date(period2 as string) : new Date(),
        interval: interval as any,
      };

      const history = await yahooFinance.historical(symbol, queryOptions);
      res.json(history);
    } catch (error) {
      console.error('Error fetching historical data:', error);
      res.status(500).json({ error: 'Failed to fetch historical data' });
    }
  });

  // Get market movers (gainers/losers) - Using mock data for now
  app.get('/api/market/movers/:type', async (req, res) => {
    try {
      const { type } = req.params; // 'gainers' or 'losers'
      const { count = 20 } = req.query;

      // Mock data for demonstration - replace with real API calls later
      const mockGainers = [
        { symbol: "NVDA", name: "NVIDIA Corp", price: 145.32, change: "+12.4%", vol: "45M" },
        { symbol: "AMD", name: "Adv Micro Dev", price: 178.90, change: "+8.2%", vol: "22M" },
        { symbol: "PLTR", name: "Palantir Tech", price: 24.50, change: "+7.8%", vol: "18M" },
        { symbol: "COIN", name: "Coinbase Global", price: 265.12, change: "+6.5%", vol: "12M" },
        { symbol: "TSLA", name: "Tesla Inc", price: 180.45, change: "+5.9%", vol: "35M" },
      ];

      const mockLosers = [
        { symbol: "INTC", name: "Intel Corp", price: 30.12, change: "-8.4%", vol: "30M" },
        { symbol: "WBA", name: "Walgreens Boots", price: 18.45, change: "-7.2%", vol: "10M" },
        { symbol: "LULU", name: "Lululemon", price: 290.50, change: "-6.8%", vol: "5M" },
        { symbol: "NKE", name: "Nike Inc", price: 92.30, change: "-5.5%", vol: "12M" },
        { symbol: "BA", name: "Boeing Co", price: 175.60, change: "-4.9%", vol: "8M" },
      ];

      const data = type === 'gainers' ? mockGainers : mockLosers;
      res.json(data.slice(0, parseInt(count as string)));
    } catch (error) {
      console.error('Error fetching market movers:', error);
      res.status(500).json({ error: 'Failed to fetch market movers' });
    }
  });

  // Get trending symbols
  app.get('/api/market/trending', async (req, res) => {
    try {
      const { count = 10 } = req.query;
      const trending = await yahooFinance.trendingSymbols('en-us', { count: parseInt(count as string) });
      res.json(trending);
    } catch (error) {
      console.error('Error fetching trending symbols:', error);
      res.status(500).json({ error: 'Failed to fetch trending symbols' });
    }
  });

  // Get market summary - Using mock data for now
  app.get('/api/market/summary', async (req, res) => {
    try {
      // Mock market indices data
      const summary = [
        { symbol: '^GSPC', name: 'S&P 500', price: 4200.50, change: '+0.8%' },
        { symbol: '^IXIC', name: 'NASDAQ', price: 12800.75, change: '+1.2%' },
        { symbol: '^DJI', name: 'Dow Jones', price: 33500.25, change: '+0.5%' }
      ];

      res.json(summary);
    } catch (error) {
      console.error('Error fetching market summary:', error);
      res.status(500).json({ error: 'Failed to fetch market summary' });
    }
  });

  return httpServer;
}
