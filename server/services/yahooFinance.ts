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
  change: string;
  vol: string;
  currency: string;
}

// Get stock quote
export async function getStockQuote(symbol: string): Promise<StockQuote> {
  const quote: any = await yahooFinanceInstance.quote(symbol);

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
}

// Get market movers (gainers or losers)
export async function getMarketMovers(type: 'gainers' | 'losers', count: number = 20): Promise<MarketMover[]> {
  // Use screener API instead of deprecated dailyGainers/dailyLosers
  const scrId = type === 'gainers' ? 'day_gainers' : 'day_losers';
  const screen = await yahooFinanceInstance.screener({ scrIds: scrId, count });

  return screen?.quotes?.map((quote: any) => ({
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
  })) || [];
}

// Get historical data
export async function getHistoricalData(symbol: string, period1?: Date, period2?: Date, interval: string = '5m') {
  const queryOptions = {
    period1: period1 || new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
    period2: period2 || new Date(),
    interval: interval as any,
  };

  return await yahooFinanceInstance.historical(symbol, queryOptions);
}