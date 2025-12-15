import { Request, Response } from 'express';
import { getMarketMovers } from '../../services/yahooFinance';
import { getLatestMarketMovers } from '../../services/clickhouse';

// Get market movers (gainers or losers)
export async function getMarketMoversController(req: Request, res: Response) {
  const { type } = req.params; // 'gainers' or 'losers'
  const { count = 20 } = req.query;

  try {
    console.log(`[${new Date().toISOString()}] Fetching ${type} market movers, count: ${count}`);
    const result = await getMarketMovers(type as 'gainers' | 'losers', parseInt(count as string));
    console.log(`[${new Date().toISOString()}] Returning ${result.length} ${type} results`);
    res.json(result);
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
    // Use screener API for day gainers as trending symbols
    const screen = await getMarketMovers('gainers', Math.ceil(parseInt(count as string) / 2));
    console.log(`[${new Date().toISOString()}] Trending symbols fetched successfully: ${screen.length} symbols`);

    // Format as trending symbols format
    const trending = {
      symbols: screen.map((quote: any) => ({
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