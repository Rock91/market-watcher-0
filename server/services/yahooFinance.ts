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
export type Interval = '1m' | '5m' | '15m' | '1d' | '1wk' | '1mo';
export async function getHistoricalData(symbol: string, period1?: Date, period2?: Date, interval: Interval = '5m') {
  const queryOptions = {
    period1: period1 || new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
    period2: period2 || new Date(),
    interval: interval,
  };

  try {
    return await yahooFinanceInstance.historical(symbol, queryOptions);
  } catch (error) {
    console.error(`Error fetching historical data for ${symbol}:`, error);
    throw error;
  }
}