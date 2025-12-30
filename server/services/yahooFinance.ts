import yahooFinance from 'yahoo-finance2';

// Initialize Yahoo Finance API
// Note: Validation errors are handled per-call using validateResult: false option
// This prevents schema validation errors from breaking functionality when data is actually valid
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
  dayOpen: number;
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
  // Ensure symbol is a string, not an object
  const symbolStr = typeof symbol === 'string' ? symbol.trim() : String(symbol);
  
  if (!symbolStr || symbolStr === '[object Object]' || symbolStr.length === 0) {
    throw new Error(`Invalid symbol: ${symbolStr || 'undefined'}`);
  }
  
  try {
    const quote: any = await yahooFinanceInstance.quote(symbolStr);

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
      dayOpen: quote.regularMarketOpen || 0,
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
    // Use validateResult: false in moduleOptions (3rd parameter) to skip validation errors
    // Data is often valid even when schema validation fails
    // Type assertions needed due to strict TypeScript definitions when validation is disabled
    const screen: any = await yahooFinanceInstance.screener(
      { scrIds: scrId, count }, 
      undefined, 
      { validateResult: false } as any
    );

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
  const now = new Date();
  let startDate = period1 || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  let endDate = period2 || new Date(now);
  
  // Validate dates
  if (startDate >= endDate) {
    throw new Error(`Invalid date range: startDate (${startDate.toISOString()}) must be before endDate (${endDate.toISOString()})`);
  }
  
  if (startDate > now) {
    console.warn(`[Yahoo Finance] Start date is in the future, adjusting to 30 days ago`);
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
  
  if (endDate > now) {
    console.warn(`[Yahoo Finance] End date is in the future, adjusting to now`);
    endDate = new Date(now);
  }
  
  // Ensure startDate is still before endDate after adjustments
  if (startDate >= endDate) {
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 30);
  }
  
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
                           errorMessage.includes('not found') ||
                           errorMessage.includes("Data doesn't exist");
    
    // Check for invalid date range errors
    const isDateRangeError = errorMessage.includes("Data doesn't exist for startDate") ||
                             errorMessage.includes('Invalid date range') ||
                             errorMessage.includes('startDate') && errorMessage.includes('endDate');
    
    if (isDelistedError || isDateRangeError) {
      // Log as warning (not error) for delisted symbols or invalid date ranges - these are expected
      console.warn(`[Yahoo Finance] No historical data available for ${symbol} (may be delisted, unavailable, or date range invalid): ${errorMessage}`);
      // Return empty array instead of throwing - let the controller handle fallback
      return [];
    }
    
    // For other errors, log and re-throw
    console.error(`[Yahoo Finance] Error fetching historical data for ${symbol}:`, error);
    throw error;
  }
}

// Major forex currency pairs
export const MAJOR_FOREX_PAIRS = [
  'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'USDCHF=X', 'AUDUSD=X',
  'NZDUSD=X', 'USDCAD=X', 'EURGBP=X', 'EURJPY=X', 'GBPJPY=X',
  'EURCHF=X', 'AUDJPY=X', 'EURAUD=X', 'EURCAD=X', 'GBPAUD=X',
  'GBPCAD=X', 'GBPCHF=X', 'CHFJPY=X', 'AUDNZD=X', 'AUDCAD=X'
];

// Get forex quote (currency pair)
export async function getForexQuote(symbol: string): Promise<StockQuote> {
  // Ensure symbol has =X suffix for forex pairs
  const symbolStr = symbol.endsWith('=X') ? symbol : `${symbol}=X`;
  
  try {
    const quote: any = await yahooFinanceInstance.quote(symbolStr);

    if (!quote) {
      throw new Error(`No quote found for forex pair: ${symbol}`);
    }

    return {
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || symbolStr,
      price: quote.regularMarketPrice || 0,
      change: quote.regularMarketChange || 0,
      changePercent: quote.regularMarketChangePercent || 0,
      volume: quote.regularMarketVolume || 0,
      marketCap: 0, // Not applicable for forex
      peRatio: 0, // Not applicable for forex
      dayHigh: quote.regularMarketDayHigh || 0,
      dayLow: quote.regularMarketDayLow || 0,
      dayOpen: quote.regularMarketOpen || 0,
      previousClose: quote.regularMarketPreviousClose || 0,
      currency: quote.currency || 'USD'
    };
  } catch (error) {
    console.error(`Error fetching forex quote for ${symbol}:`, error);
    throw error;
  }
}

// Get multiple forex quotes
export async function getForexQuotes(symbols: string[]): Promise<StockQuote[]> {
  const quotes: StockQuote[] = [];
  
  for (const symbol of symbols) {
    try {
      const quote = await getForexQuote(symbol);
      quotes.push(quote);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      // Continue with other symbols even if one fails
      console.warn(`Failed to fetch ${symbol}:`, error);
    }
  }
  
  return quotes;
}

// Get trending symbols with robust error handling for schema validation issues
export async function getTrendingSymbols(region: string, count: number = 20): Promise<any> {
  try {
    // Try with validation disabled first
    const result: any = await yahooFinanceInstance.trendingSymbols(
      region, 
      { count }, 
      { validateResult: false } as any
    );
    
    // Check if result has the expected structure
    if (result && (result.quotes || result.count !== undefined)) {
      return result;
    }
    
    // If result structure is unexpected, try to extract data anyway
    return result;
  } catch (error: any) {
    // Handle all types of validation errors
    const errorName = error?.name || error?.constructor?.name || '';
    const errorMessage = error?.message || String(error) || '';
    
    // Check for various validation error patterns
    const isValidationError = 
      errorName.includes('FailedYahooValidationError') ||
      errorName.includes('ValidationError') ||
      errorName.includes('YahooValidationError') ||
      errorMessage.includes('Failed Yahoo Schema validation') ||
      errorMessage.includes('Expected an object') ||
      errorMessage.includes('schemaPath') ||
      errorMessage.includes('TrendingSymbolsResult') ||
      error?.schemaPath !== undefined ||
      error?.schema !== undefined;
    
    // If it's a validation error, try to extract data from error.result
    if (isValidationError) {
      // Check multiple possible locations for the result data
      const resultData = error?.result || error?.data || error;
      
      // If we have quotes in the result, return it
      if (resultData && (resultData.quotes || resultData.count !== undefined)) {
        console.warn(`[Yahoo Finance] Schema validation failed for trending symbols (${region}), but extracted data from error result`);
        return resultData;
      }
      
      // If we have a result object but no quotes, try to construct a valid response
      if (resultData && typeof resultData === 'object') {
        // Sometimes the data is nested differently
        const quotes = resultData.quotes || resultData.data || [];
        if (Array.isArray(quotes) && quotes.length > 0) {
          console.warn(`[Yahoo Finance] Schema validation failed for trending symbols (${region}), but extracted quotes from error result`);
          return { quotes, count: quotes.length };
        }
      }
    }
    
    // For non-validation errors or if we can't extract data, log and re-throw
    console.error(`[Yahoo Finance] Error fetching trending symbols for ${region}:`, errorMessage);
    throw error;
  }
}