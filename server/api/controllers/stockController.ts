import { Request, Response } from 'express';
import { getStockQuote, getHistoricalData } from '../../services/yahooFinance';
import { 
  getStockHistory, 
  getLatestStockQuote, 
  storeStockQuote,
  getHistoricalData as getDbHistoricalData,
  storeHistoricalData,
  getLatestTechnicalIndicators
} from '../../services/clickhouse';
import { calculateAllIndicators, getVolatilityLevel, getRSILevel } from '../../services/technicalIndicators';

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
    
    console.log(`[${new Date().toISOString()}] Yahoo Finance returned ${history?.length || 0} records for ${symbol}`);

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

    console.log(`[${new Date().toISOString()}] Returning ${formattedHistory.length} historical data points for ${symbol}`);
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

    const history = await getStockHistory(symbol, parseInt(hours as string));

      console.log(`[${new Date().toISOString()}] Retrieved ${history.length} historical records for ${symbol}`);
      res.json(history);
    } catch (error) {
      const symbolParam = req.params.symbol;
      console.error(`[${new Date().toISOString()}] Error fetching ClickHouse history for ${symbolParam}:`, error);
    res.status(500).json({ error: 'Failed to fetch historical data from ClickHouse' });
  }
}

// Get technical indicators (RSI, MACD, Volatility) for a stock
export async function getTechnicalIndicatorsController(req: Request, res: Response) {
  try {
    const { symbol } = req.params;
    const { days = 30 } = req.query;

    console.log(`[${new Date().toISOString()}] Fetching technical indicators for ${symbol}, ${days} days`);

    // First, try to get stored indicators from database (if fresh)
    const storedIndicators = await getLatestTechnicalIndicators(symbol);
    if (storedIndicators) {
      const indicatorAge = Date.now() - storedIndicators.date.getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      if (indicatorAge < maxAge) {
        console.log(`[${new Date().toISOString()}] Returning stored indicators for ${symbol} (${Math.round(indicatorAge / 1000 / 60)} minutes old)`);
        
        // Format response with stored data
        const response = {
          symbol,
          indicators: {
            rsi: {
              value: Math.round(storedIndicators.rsi * 10) / 10,
              level: getRSILevel(storedIndicators.rsi),
              interpretation: storedIndicators.rsi > 70 
                ? 'Overbought - Potential sell signal' 
                : storedIndicators.rsi < 30 
                ? 'Oversold - Potential buy signal'
                : 'Neutral'
            },
            macd: {
              value: Math.round(storedIndicators.macdValue * 1000) / 1000,
              signal: Math.round(storedIndicators.macdSignal * 1000) / 1000,
              histogram: Math.round(storedIndicators.macdHistogram * 1000) / 1000,
              interpretation: storedIndicators.macdHistogram > 0 
                ? 'Bullish - MACD above signal line' 
                : 'Bearish - MACD below signal line'
            },
            volatility: {
              value: Math.round(storedIndicators.volatilityPercent * 10) / 10,
              level: getVolatilityLevel(storedIndicators.volatilityPercent),
              interpretation: getVolatilityLevel(storedIndicators.volatilityPercent) === 'High'
                ? 'High volatility - Higher risk/reward'
                : getVolatilityLevel(storedIndicators.volatilityPercent) === 'Low'
                ? 'Low volatility - Stable price movement'
                : 'Medium volatility - Moderate price movement'
            }
          },
          dataPoints: storedIndicators.dataPoints,
          lastUpdated: storedIndicators.date.toISOString(),
          source: 'database'
        };
        
        return res.json(response);
      }
    }

    // If no stored indicators or stale, calculate from historical data
    console.log(`[${new Date().toISOString()}] Calculating indicators from historical data for ${symbol}...`);

    // Get historical data (prefer database, fallback to Yahoo Finance)
    let historicalData: any[] = await getDbHistoricalData(symbol, parseInt(days as string));
    
    // If no data in DB, fetch from Yahoo Finance
    if (!historicalData || historicalData.length === 0) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days as string));
      const endDate = new Date();
      
      historicalData = await getHistoricalData(symbol, startDate, endDate, '1d');
      
      // Store in database for future use
      if (historicalData && historicalData.length > 0) {
        await storeHistoricalData(symbol, historicalData);
      }
    }

    if (!historicalData || historicalData.length === 0) {
      return res.status(404).json({ error: 'No historical data available for this symbol' });
    }

    // Sort historical data by date (ascending) to ensure chronological order
    const sortedData = [...historicalData].sort((a: any, b: any) => {
      const dateA = new Date(a.date || a.time || 0);
      const dateB = new Date(b.date || b.time || 0);
      return dateA.getTime() - dateB.getTime();
    });

    // Extract closing prices (use close price, fallback to price field)
    const prices = sortedData
      .map((item: any) => item.close || item.price || 0)
      .filter((price: number) => price > 0);

    if (prices.length < 2) {
      return res.status(400).json({ error: 'Insufficient data to calculate indicators' });
    }

    // Calculate indicators
    const indicators = calculateAllIndicators(prices);

    // Format response with additional context
    const response = {
      symbol,
      indicators: {
        rsi: {
          value: Math.round(indicators.rsi * 10) / 10, // Round to 1 decimal
          level: getRSILevel(indicators.rsi),
          interpretation: indicators.rsi > 70 
            ? 'Overbought - Potential sell signal' 
            : indicators.rsi < 30 
            ? 'Oversold - Potential buy signal'
            : 'Neutral'
        },
        macd: {
          value: Math.round(indicators.macd.value * 1000) / 1000, // Round to 3 decimals
          signal: Math.round(indicators.macd.signal * 1000) / 1000,
          histogram: Math.round(indicators.macd.histogram * 1000) / 1000,
          interpretation: indicators.macd.histogram > 0 
            ? 'Bullish - MACD above signal line' 
            : 'Bearish - MACD below signal line'
        },
        volatility: {
          value: Math.round(indicators.volatilityPercent * 10) / 10, // Round to 1 decimal
          level: getVolatilityLevel(indicators.volatilityPercent),
          interpretation: getVolatilityLevel(indicators.volatilityPercent) === 'High'
            ? 'High volatility - Higher risk/reward'
            : getVolatilityLevel(indicators.volatilityPercent) === 'Low'
            ? 'Low volatility - Stable price movement'
            : 'Medium volatility - Moderate price movement'
        }
      },
      dataPoints: prices.length,
      lastUpdated: new Date().toISOString(),
      source: 'calculated'
    };

    console.log(`[${new Date().toISOString()}] Calculated indicators for ${symbol}: RSI=${response.indicators.rsi.value}, MACD=${response.indicators.macd.value}, Volatility=${response.indicators.volatility.value}%`);
    
    res.json(response);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error calculating technical indicators:`, error);
    res.status(500).json({ error: 'Failed to calculate technical indicators', details: error.message });
  }
}