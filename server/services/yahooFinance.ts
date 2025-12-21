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
  } catch (error: any) {
    // Handle Yahoo Finance validation errors - data might still be available in error.result
    const errorName = error?.name || error?.constructor?.name || '';
    const isValidationError = errorName.includes('FailedYahooValidationError') || 
                              errorName.includes('ValidationError') ||
                              error?.message?.includes('Failed Yahoo Schema validation');
    
    if (isValidationError && error?.result?.quotes) {
      // Extract data from validation error - data is valid, just schema validation failed
      console.warn(`[Yahoo Finance] Schema validation failed for ${type} market movers, but extracting data from error result`);
      const quotes = error.result.quotes || [];
      return quotes.map((quote: any) => ({
        symbol: quote.symbol || '',
        name: quote.shortName || quote.longName || '',
        price: quote.regularMarketPrice || 0,
        changePercent: quote.regularMarketChangePercent || 0,
        volume: quote.regularMarketVolume || 0,
        currency: quote.currency || 'USD'
      }));
    }
    
    // For other errors, log and re-throw
    console.error(`[Yahoo Finance] Error fetching market movers for ${type}:`, error?.message || error);
    throw error;
  }
}

// Get historical data
// Note: yahoo-finance2's historical() only supports '1d', '1wk', '1mo' intervals
export type Interval = '1d' | '1wk' | '1mo';

export async function getHistoricalData(symbol: string, period1?: Date, period2?: Date, interval: string = '1d') {
  // Ensure dates are valid - default to 30 days of history for daily data
  const startDate = period1 || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  const endDate = period2 || new Date();
  
  // yahoo-finance2 historical only supports: '1d', '1wk', '1mo'
  // Map any unsupported intervals to '1d'
  const validIntervals = ['1d', '1wk', '1mo'];
  const actualInterval = validIntervals.includes(interval) ? interval : '1d';
  
  if (interval !== actualInterval) {
    console.warn(`[Yahoo Finance] Interval '${interval}' not supported for historical data. Using '${actualInterval}' instead.`);
  }

  const queryOptions: any = {
    period1: startDate,
    period2: endDate,
    interval: actualInterval,
  };

  try {
    const data = await yahooFinanceInstance.historical(symbol, queryOptions);
    return data;
  } catch (error: any) {
    // Check if it's a "no data" or "delisted" error - these are expected for some symbols
    const errorMessage = error?.message || String(error);
    const isDelistedError = errorMessage.includes('No data found') || 
                           errorMessage.includes('delisted') ||
                           errorMessage.includes('not found');
    
    if (isDelistedError) {
      // Log as warning (not error) for delisted symbols - this is expected
      console.warn(`[Yahoo Finance] No historical data available for ${symbol} (may be delisted or unavailable)`);
      // Return empty array instead of throwing - let the controller handle fallback
      return [];
    }
    
    // For other errors, log and re-throw
    console.error(`[Yahoo Finance] Error fetching historical data for ${symbol}:`, error);
    throw error;
  }
}