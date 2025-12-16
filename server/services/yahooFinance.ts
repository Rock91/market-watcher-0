import yahooFinance from 'yahoo-finance2';

// Initialize Yahoo Finance API
export const yahooFinanceInstance = new yahooFinance();

// Stock quote interface
export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  peRatio: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  currency: string;
}

// Market mover interface
export interface MarketMover {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  currency: string;
}

// Get stock quote
export async function getStockQuote(symbol: string): Promise<StockQuote> {
  try {
    const quote: any = await yahooFinanceInstance.quote(symbol);

    if (!quote) {
      throw new Error(`No quote found for symbol: ${symbol}`);
    }

    return {
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
  } catch (error) {
    console.error(`Error fetching stock quote for ${symbol}:`, error);
    throw error;
  }
}

// Get market movers (gainers or losers)
export async function getMarketMovers(type: 'gainers' | 'losers', count: number = 20): Promise<MarketMover[]> {
  try {
    const scrId = type === 'gainers' ? 'day_gainers' : 'day_losers';
    const screen = await yahooFinanceInstance.screener({ scrIds: scrId, count });

    return screen?.quotes?.map((quote: any) => ({
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || '',
      price: quote.regularMarketPrice || 0,
      changePercent: quote.regularMarketChangePercent || 0,
      volume: quote.regularMarketVolume || 0,
      currency: quote.currency || 'USD'
    })) || [];
  } catch (error) {
    console.error(`Error fetching market movers for ${type}:`, error);
    throw error;
  }
}

// Get historical data
export type Interval = '1m' | '2m' | '5m' | '15m' | '30m' | '60m' | '90m' | '1h' | '1d' | '5d' | '1wk' | '1mo' | '3mo';
export async function getHistoricalData(symbol: string, period1?: Date, period2?: Date, interval: string = '5m') {
  // Ensure dates are valid
  const startDate = period1 || new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  const endDate = period2 || new Date();
  
  // For intraday intervals, use a shorter time period (max 7 days for intraday)
  const isIntraday = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'].includes(interval);
  
  if (isIntraday) {
    // Limit intraday requests to last 7 days
    const maxDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const actualStartDate = startDate < maxDaysAgo ? maxDaysAgo : startDate;
    
    const queryOptions: any = {
      period1: actualStartDate,
      period2: endDate,
      interval: interval as any,
    };

    try {
      return await yahooFinanceInstance.historical(symbol, queryOptions);
    } catch (error) {
      console.error(`Error fetching historical data for ${symbol}:`, error);
      // Fallback to daily data if intraday fails
      const fallbackOptions: any = {
        period1: actualStartDate,
        period2: endDate,
        interval: '1d',
      };
      return await yahooFinanceInstance.historical(symbol, fallbackOptions);
    }
  } else {
    // For daily/weekly/monthly intervals
    const queryOptions: any = {
      period1: startDate,
      period2: endDate,
      interval: interval as any,
    };

    try {
      return await yahooFinanceInstance.historical(symbol, queryOptions);
    } catch (error) {
      console.error(`Error fetching historical data for ${symbol}:`, error);
      throw error;
    }
  }
}