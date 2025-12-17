import { Request, Response } from 'express';
import { getStockQuote, getHistoricalData } from '../../services/yahooFinance';
import { 
  getStockHistory, 
  getLatestStockQuote, 
  storeStockQuote,
  getHistoricalData as getDbHistoricalData,
  storeHistoricalData
} from '../../services/clickhouse';

// Get stock quote - first check DB, then fallback to Yahoo Finance
export async function getStockQuoteController(req: Request, res: Response) {
  const { symbol } = req.params;

  try {
    console.log(`[${new Date().toISOString()}] Fetching quote for symbol: ${symbol}`);
    
    // First, try to get from database (cached data from background job)
    const cachedQuote = await getLatestStockQuote(symbol);
    
    // Check if cached data is fresh (within last 2 minutes)
    if (cachedQuote) {
      const cacheAge = Date.now() - new Date(cachedQuote.timestamp).getTime();
      const isFresh = cacheAge < 2 * 60 * 1000; // 2 minutes
      
      if (isFresh) {
        console.log(`[${new Date().toISOString()}] Returning cached quote for ${symbol} (${Math.round(cacheAge / 1000)}s old)`);
        return res.json({
          symbol: cachedQuote.symbol,
          name: '', // Name not stored in quotes table
          price: cachedQuote.price,
          change: cachedQuote.change,
          changePercent: cachedQuote.change_percent,
          volume: cachedQuote.volume,
          marketCap: cachedQuote.market_cap,
          peRatio: cachedQuote.pe_ratio,
          dayHigh: cachedQuote.day_high,
          dayLow: cachedQuote.day_low,
          previousClose: cachedQuote.previous_close,
          currency: cachedQuote.currency || 'USD'
        });
      }
    }
    
    // If not in cache or stale, fetch from Yahoo Finance
    console.log(`[${new Date().toISOString()}] Cache miss for ${symbol}, fetching from Yahoo Finance...`);
    const quote = await getStockQuote(symbol);
    
    // Store in database for future requests
    await storeStockQuote(quote);
    
    console.log(`[${new Date().toISOString()}] Quote fetched successfully for ${symbol}: $${quote.price?.toFixed(2)}`);
    res.json(quote);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching stock quote for ${symbol}:`, error);
    res.status(500).json({ error: 'Failed to fetch stock quote' });
  }
}

// Get historical data - first check DB, then fallback to Yahoo Finance
export async function getHistoricalDataController(req: Request, res: Response) {
  try {
    const { symbol } = req.params;
    const { period1, period2, interval = '1d' } = req.query;

    const startDate = period1 ? new Date(period1 as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = period2 ? new Date(period2 as string) : new Date();
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));

    console.log(`[${new Date().toISOString()}] Fetching historical data for ${symbol}, ${days} days`);

    // First, try to get from database
    const cachedData: any = await getDbHistoricalData(symbol, days);
    
    if (cachedData && cachedData.length > 0) {
      console.log(`[${new Date().toISOString()}] Returning ${cachedData.length} cached historical records for ${symbol}`);
      
      // Format for the chart
      const formattedHistory = cachedData.map((item: any) => ({
        date: item.date,
        time: new Date(item.date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        }),
        price: item.close,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume
      }));

      return res.json(formattedHistory);
    }

    // If not in cache, fetch from Yahoo Finance
    console.log(`[${new Date().toISOString()}] Cache miss for ${symbol} historical data, fetching from Yahoo Finance...`);
    
    const history: any = await getHistoricalData(symbol, startDate, endDate, interval as string);

    // Store in database for future requests
    if (history && history.length > 0) {
      await storeHistoricalData(symbol, history);
    }

    // Format the response for the chart
    const formattedHistory = history.map((item: any) => ({
      date: item.date,
      time: new Date(item.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      }),
      price: item.close,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume
    }));

    res.json(formattedHistory);
  } catch (error) {
    console.error('Error fetching historical data:', error);
    // Fallback to generated data
    const fallbackData = [];
    let price = 100; // Base price
    for (let i = 0; i < 30; i++) {
      price = price * (1 + (Math.random() * 0.04 - 0.02));
      const date = new Date();
      date.setDate(date.getDate() - (30 - i));
      fallbackData.push({
        date: date.toISOString(),
        time: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        price: price,
        open: price * 0.99,
        high: price * 1.01,
        low: price * 0.98,
        close: price,
        volume: Math.floor(Math.random() * 1000000)
      });
    }
    res.json(fallbackData);
  }
}

// Get historical stock quotes from ClickHouse
export async function getStockHistoryController(req: Request, res: Response) {
  try {
    const { symbol } = req.params;
    const { hours = 24, limit = 1000 } = req.query;

    console.log(`[${new Date().toISOString()}] Fetching ClickHouse history for ${symbol}, last ${hours} hours, limit ${limit}`);

    const history = await getStockHistory(symbol, parseInt(hours as string), parseInt(limit as string));

    console.log(`[${new Date().toISOString()}] Retrieved ${history.length} historical records for ${symbol}`);
    res.json(history);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching ClickHouse history for ${symbol}:`, error);
    res.status(500).json({ error: 'Failed to fetch historical data from ClickHouse' });
  }
}