import { Request, Response } from 'express';
import { getMarketMovers } from '../../services/yahooFinance';
import { getLatestMarketMovers, storeMarketMovers } from '../../services/clickhouse';

// Get market movers (gainers or losers)
export async function getMarketMoversController(req: Request, res: Response) {
  const { type } = req.params; // 'gainers' or 'losers'
  const { count = 20 } = req.query;

  try {
    // First, try to get data from ClickHouse
    const cachedMovers = await getLatestMarketMovers(type as 'gainers' | 'losers', parseInt(count as string));

    if (cachedMovers.length > 0) {
      console.log(`[${new Date().toISOString()}] Returning cached ${type} market movers`);
      return res.json(cachedMovers);
    }

    // If not in cache, fetch from Yahoo Finance
    console.log(`[${new Date().toISOString()}] Fetching ${type} market movers from Yahoo Finance, count: ${count}`);
    const newMovers = await getMarketMovers(type as 'gainers' | 'losers', parseInt(count as string));

    // Store in ClickHouse for future requests
    if (newMovers.length > 0) {
      await storeMarketMovers(type as 'gainers' | 'losers', newMovers);
    }

    console.log(`[${new Date().toISOString()}] Returning ${newMovers.length} ${type} results`);
    res.json(newMovers);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching market movers:`, error);
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
}

// Get trending symbols
export async function getTrendingSymbolsController(req: Request, res: Response) {
  const { count = 20 } = req.query;
  console.log(`[${new Date().toISOString()}] Fetching trending symbols, count: ${count}`);

  try {
    // First, try to get data from ClickHouse
    const cachedMovers = await getLatestMarketMovers('gainers', parseInt(count as string));

    if (cachedMovers.length > 0) {
      console.log(`[${new Date().toISOString()}] Returning cached trending symbols`);
      const trending = {
        symbols: cachedMovers.map((quote: any) => ({
          symbol: quote.symbol,
          name: quote.name,
          price: quote.price
        }))
      };
      return res.json(trending);
    }

    // If not in cache, fetch from Yahoo Finance
    const newMovers = await getMarketMovers('gainers', Math.ceil(parseInt(count as string) / 2));
    console.log(`[${new Date().toISOString()}] Trending symbols fetched successfully: ${newMovers.length} symbols`);

    // Store in ClickHouse for future requests
    if (newMovers.length > 0) {
      await storeMarketMovers('gainers', newMovers);
    }

    // Format as trending symbols format
    const trending = {
      symbols: newMovers.map((quote: any) => ({
        symbol: quote.symbol,
        name: quote.name,
        price: quote.price
      }))
    };

    res.json(trending);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching trending symbols:`, error);
    res.status(500).json({ error: 'Failed to fetch trending symbols' });
  }
}

// Get historical market movers from ClickHouse
export async function getMarketMoversHistoryController(req: Request, res: Response) {
  try {
    const { type, limit = 100 } = req.query; // type: 'gainers' or 'losers'

    console.log(`[${new Date().toISOString()}] Fetching ClickHouse market movers, type: ${type}, limit ${limit}`);

    const history = await getLatestMarketMovers(type as 'gainers' | 'losers', parseInt(limit as string));

    console.log(`[${new Date().toISOString()}] Retrieved ${history.length} market movers records`);
    res.json(history);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching ClickHouse market movers:`, error);
    res.status(500).json({ error: 'Failed to fetch market movers from ClickHouse' });
  }
}
