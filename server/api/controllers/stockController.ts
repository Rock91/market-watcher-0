import { Request, Response } from 'express';
import { getStockQuote, getHistoricalData } from '../../services/yahooFinance';
import { getStockHistory } from '../../services/clickhouse';

// Get stock quote
export async function getStockQuoteController(req: Request, res: Response) {
  const { symbol } = req.params;

  try {
    console.log(`[${new Date().toISOString()}] Fetching quote for symbol: ${symbol}`);
    const quote = await getStockQuote(symbol);
    console.log(`[${new Date().toISOString()}] Quote fetched successfully for ${symbol}: $${quote.price?.toFixed(2)}`);
    res.json(quote);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching stock quote for ${symbol}:`, error);
    res.status(500).json({ error: 'Failed to fetch stock quote' });
  }
}

// Get historical data
export async function getHistoricalDataController(req: Request, res: Response) {
  try {
    const { symbol } = req.params;
    const { period1, period2, interval = '5m' } = req.query;

    const queryOptions = {
      period1: period1 ? new Date(period1 as string) : new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
      period2: period2 ? new Date(period2 as string) : new Date(),
      interval: interval as any,
    };

    const history: any = await getHistoricalData(symbol, queryOptions.period1, queryOptions.period2, queryOptions.interval);

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