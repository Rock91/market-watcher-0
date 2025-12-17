/**
 * Data Fetcher Job
 * 
 * This background job periodically fetches data from Yahoo Finance API
 * and stores it in ClickHouse database. This allows the API to serve
 * data from the database instead of making direct API calls.
 */

import { 
  getStockQuote, 
  getMarketMovers, 
  getHistoricalData as fetchYahooHistoricalData,
  yahooFinanceInstance 
} from '../services/yahooFinance';
import {
  storeStockQuote,
  storeStockQuotes,
  storeMarketMovers,
  storeTrackedSymbolsFromMovers,
  storeHistoricalData,
  storeTrendingSymbols,
  isDataFresh,
} from '../services/clickhouse';

// Popular symbols to track
const POPULAR_SYMBOLS = [
  'AAPL', 'GOOGL', 'GOOG', 'MSFT', 'AMZN', 'META', 'TSLA', 'NVDA',
  'JPM', 'V', 'JNJ', 'WMT', 'PG', 'MA', 'UNH', 'HD', 'DIS', 'BAC',
  'NFLX', 'ADBE', 'CRM', 'PYPL', 'INTC', 'AMD', 'ORCL', 'CSCO'
];

// Fetch interval in milliseconds
const QUOTE_FETCH_INTERVAL = 60 * 1000; // 1 minute for quotes
const MOVERS_FETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes for movers
const HISTORICAL_FETCH_INTERVAL = 30 * 60 * 1000; // 30 minutes for historical data
const TRENDING_FETCH_INTERVAL = 10 * 60 * 1000; // 10 minutes for trending

let isRunning = false;

/**
 * Fetch and store stock quotes for popular symbols
 */
async function fetchAndStoreQuotes() {
  console.log(`[${new Date().toISOString()}] [DataFetcher] Fetching stock quotes...`);
  
  let successCount = 0;
  let errorCount = 0;
  const quotesToStore: any[] = [];

  for (const symbol of POPULAR_SYMBOLS) {
    try {
      const quote = await getStockQuote(symbol);
      quotesToStore.push(quote);
      successCount++;
    } catch (error) {
      errorCount++;
      // Don't log each error to avoid spam
    }
    
    // Small delay to avoid rate limiting
    await sleep(100);
  }

  // Batch insert to ClickHouse (significantly reduces overhead)
  if (quotesToStore.length > 0) {
    await storeStockQuotes(quotesToStore);
  }

  console.log(`[${new Date().toISOString()}] [DataFetcher] Quotes fetched: ${successCount} success, ${errorCount} errors`);
}

/**
 * Fetch and store market movers (gainers and losers)
 */
async function fetchAndStoreMovers() {
  console.log(`[${new Date().toISOString()}] [DataFetcher] Fetching market movers...`);

  try {
    // Fetch gainers
    const gainers = await getMarketMovers('gainers', 20);
    if (gainers.length > 0) {
      await storeMarketMovers('gainers', gainers);
      await storeTrackedSymbolsFromMovers('gainers', gainers);
    }

    // Small delay between requests
    await sleep(500);

    // Fetch losers
    const losers = await getMarketMovers('losers', 20);
    if (losers.length > 0) {
      await storeMarketMovers('losers', losers);
      await storeTrackedSymbolsFromMovers('losers', losers);
    }

    console.log(`[${new Date().toISOString()}] [DataFetcher] Market movers: ${gainers.length} gainers, ${losers.length} losers`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [DataFetcher] Error fetching market movers:`, error);
  }
}

/**
 * Fetch and store historical data for popular symbols
 */
async function fetchAndStoreHistoricalData() {
  console.log(`[${new Date().toISOString()}] [DataFetcher] Fetching historical data...`);

  let successCount = 0;
  let errorCount = 0;

  for (const symbol of POPULAR_SYMBOLS.slice(0, 10)) { // Limit to first 10 to avoid rate limiting
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 30); // 30 days of history

      const historicalData = await fetchYahooHistoricalData(symbol, startDate, endDate, '1d');
      
      if (historicalData && historicalData.length > 0) {
        await storeHistoricalData(symbol, historicalData);
        successCount++;
      }
    } catch (error) {
      errorCount++;
    }

    // Delay to avoid rate limiting
    await sleep(500);
  }

  console.log(`[${new Date().toISOString()}] [DataFetcher] Historical data: ${successCount} success, ${errorCount} errors`);
}

/**
 * Fetch and store trending symbols
 */
async function fetchAndStoreTrending() {
  console.log(`[${new Date().toISOString()}] [DataFetcher] Fetching trending symbols...`);

  try {
    const trending = await yahooFinanceInstance.trendingSymbols('US', { count: 20 });
    
    if (trending?.quotes && trending.quotes.length > 0) {
      await storeTrendingSymbols(trending.quotes);
      console.log(`[${new Date().toISOString()}] [DataFetcher] Stored ${trending.quotes.length} trending symbols`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [DataFetcher] Error fetching trending symbols:`, error);
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Start the data fetcher job
 */
export function startDataFetcher() {
  if (isRunning) {
    console.log(`[${new Date().toISOString()}] [DataFetcher] Already running`);
    return;
  }

  isRunning = true;
  console.log(`[${new Date().toISOString()}] [DataFetcher] Starting background data fetcher...`);

  // Initial fetch
  setTimeout(async () => {
    await fetchAndStoreMovers();
    await fetchAndStoreTrending();
  }, 5000); // Wait 5 seconds after server start

  // Set up intervals for periodic fetching
  
  // Quotes every 1 minute
  setInterval(async () => {
    if (!isRunning) return;
    try {
      await fetchAndStoreQuotes();
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [DataFetcher] Quote fetch error:`, error);
    }
  }, QUOTE_FETCH_INTERVAL);

  // Market movers every 5 minutes
  setInterval(async () => {
    if (!isRunning) return;
    try {
      await fetchAndStoreMovers();
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [DataFetcher] Movers fetch error:`, error);
    }
  }, MOVERS_FETCH_INTERVAL);

  // Historical data every 30 minutes
  setInterval(async () => {
    if (!isRunning) return;
    try {
      await fetchAndStoreHistoricalData();
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [DataFetcher] Historical fetch error:`, error);
    }
  }, HISTORICAL_FETCH_INTERVAL);

  // Trending symbols every 10 minutes
  setInterval(async () => {
    if (!isRunning) return;
    try {
      await fetchAndStoreTrending();
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [DataFetcher] Trending fetch error:`, error);
    }
  }, TRENDING_FETCH_INTERVAL);

  console.log(`[${new Date().toISOString()}] [DataFetcher] Background jobs scheduled:
  - Quotes: every ${QUOTE_FETCH_INTERVAL / 1000}s
  - Market Movers: every ${MOVERS_FETCH_INTERVAL / 1000}s
  - Historical Data: every ${HISTORICAL_FETCH_INTERVAL / 1000}s
  - Trending: every ${TRENDING_FETCH_INTERVAL / 1000}s`);
}

/**
 * Stop the data fetcher job
 */
export function stopDataFetcher() {
  isRunning = false;
  console.log(`[${new Date().toISOString()}] [DataFetcher] Stopped`);
}

/**
 * Manually trigger a full data refresh
 */
export async function refreshAllData() {
  console.log(`[${new Date().toISOString()}] [DataFetcher] Manual refresh triggered...`);
  
  await fetchAndStoreMovers();
  await fetchAndStoreTrending();
  await fetchAndStoreQuotes();
  await fetchAndStoreHistoricalData();
  
  console.log(`[${new Date().toISOString()}] [DataFetcher] Manual refresh complete`);
}

