import { Request, Response } from 'express';
import { getMarketMovers, yahooFinanceInstance } from '../../services/yahooFinance';
import { 
  getLatestMarketMovers, 
  storeMarketMovers,
  getLatestTrendingSymbols,
  storeTrendingSymbols
} from '../../services/clickhouse';

// Get market movers (gainers or losers)
export async function getMarketMoversController(req: Request, res: Response) {
  const { type } = req.params; // 'gainers' or 'losers'
  const { count = 20 } = req.query;

  try {
    // First, try to get data from ClickHouse
    const cachedMovers = await getLatestMarketMovers(type as 'gainers' | 'losers', parseInt(count as string));

    if (cachedMovers.length > 0) {
      console.log(`[${new Date().toISOString()}] Returning cached ${type} market movers`);
      // Transform ClickHouse format to expected format
      const transformedMovers = cachedMovers.map((mover: any) => ({
        symbol: mover.symbol,
        name: mover.name,
        price: mover.price,
        change: `${mover.change_percent >= 0 ? '+' : ''}${(mover.change_percent * 100).toFixed(2)}%`,
        vol: 'N/A', // Volume not stored in ClickHouse market_movers table
        currency: 'USD'
      }));
      return res.json(transformedMovers);
    }

    // If not in cache, fetch from Yahoo Finance
    console.log(`[${new Date().toISOString()}] Fetching ${type} market movers from Yahoo Finance, count: ${count}`);
    const newMovers = await getMarketMovers(type as 'gainers' | 'losers', parseInt(count as string));

    // Transform to expected format for frontend
    const formattedMovers = newMovers.map((mover: any) => ({
      symbol: mover.symbol,
      name: mover.name,
      price: mover.price,
      change: `${mover.changePercent >= 0 ? '+' : ''}${(mover.changePercent * 100).toFixed(2)}%`,
      vol: mover.volume ? `${(mover.volume / 1000000).toFixed(1)}M` : 'N/A',
      currency: mover.currency || 'USD'
    }));

    // Store in ClickHouse for future requests (store original format)
    if (newMovers.length > 0) {
      await storeMarketMovers(type as 'gainers' | 'losers', newMovers);
    }

    console.log(`[${new Date().toISOString()}] Returning ${formattedMovers.length} ${type} results`);
    res.json(formattedMovers);
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

// Get trending symbols - first check DB, then fallback to Yahoo Finance
export async function getTrendingSymbolsController(req: Request, res: Response) {
  const { count = 20 } = req.query;
  console.log(`[${new Date().toISOString()}] Fetching trending symbols, count: ${count}`);

  try {
    // First, try to get trending from ClickHouse (cached from background job)
    const cachedTrending: any = await getLatestTrendingSymbols(parseInt(count as string));

    if (cachedTrending && cachedTrending.length > 0) {
      console.log(`[${new Date().toISOString()}] Returning ${cachedTrending.length} cached trending symbols`);
      const trending = {
        symbols: cachedTrending.map((item: any) => ({
          symbol: item.symbol,
          name: item.name,
          rank: item.rank
        }))
      };
      return res.json(trending);
    }

    // If not in cache, try to fetch from Yahoo Finance
    console.log(`[${new Date().toISOString()}] Cache miss for trending, fetching from Yahoo Finance...`);
    
    try {
      const trendingResult = await yahooFinanceInstance.trendingSymbols('US', { count: parseInt(count as string) });
      
      if (trendingResult?.quotes && trendingResult.quotes.length > 0) {
        // Store in database for future requests
        await storeTrendingSymbols(trendingResult.quotes);
        
        console.log(`[${new Date().toISOString()}] Trending symbols fetched: ${trendingResult.quotes.length} symbols`);
        
        const trending = {
          symbols: trendingResult.quotes.map((quote: any, index: number) => ({
            symbol: quote.symbol,
            name: quote.shortName || quote.longName || quote.symbol,
            rank: index + 1
          }))
        };
        return res.json(trending);
      }
    } catch (yahooError) {
      console.warn(`[${new Date().toISOString()}] Yahoo Finance trending API failed, falling back to gainers`);
    }

    // Fallback: use market gainers as trending
    const newMovers = await getMarketMovers('gainers', parseInt(count as string));
    console.log(`[${new Date().toISOString()}] Using gainers as trending: ${newMovers.length} symbols`);

    const trending = {
      symbols: newMovers.map((quote: any, index: number) => ({
        symbol: quote.symbol,
        name: quote.name,
        rank: index + 1
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
