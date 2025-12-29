/**
 * Market Data Sync Script
 * 
 * This script:
 * 1. Fetches all market movers (gainers & losers) frequently
 * 2. For each symbol, checks if historical data exists
 * 3. If historical data is missing, fetches up to 1 year of data
 * 4. Can be run as a standalone job or integrated into the server
 * 
 * Usage:
 *   npm run sync-market-data
 *   npx tsx server/scripts/marketDataSync.ts
 */

import 'dotenv/config';
import { 
  getMarketMovers, 
  getHistoricalData as fetchYahooHistoricalData,
  getStockQuote,
  getForexQuotes,
  MAJOR_FOREX_PAIRS,
  yahooFinanceInstance 
} from '../services/yahooFinance';
import {
  initializeClickHouse,
  storeStockQuote,
  storeMarketMovers,
  storeTrackedSymbolsFromMovers,
  storeHistoricalData,
  storeTrendingSymbols,
  getHistoricalDataRange,
  getAllTrackedSymbols,
  getSymbolsNeedingBackfill,
  clickhouseClient,
} from '../services/clickhouse';
import { CLICKHOUSE_CONFIG } from '../config/database';
import { isMarketOpen, getMarketStatus, getOpenMarkets, getAllMarketsStatus, MARKETS } from '../utils/helpers';

// Configuration
const CONFIG = {
  // Market movers fetch interval (1 minute)
  MOVERS_INTERVAL_MS: 60 * 1000,
  // Historical data check interval (10 minutes)
  HISTORICAL_CHECK_INTERVAL_MS: 10 * 60 * 1000,
  // Number of days to backfill (1 year)
  BACKFILL_DAYS: 365,
  // Delay between API calls to avoid rate limiting
  API_DELAY_MS: 500,
  // Maximum symbols to process per run
  MAX_SYMBOLS_PER_RUN: 50,
  // Delay between batches
  BATCH_DELAY_MS: 2000,
};

// Track processed symbols to avoid duplicates in same session
const processedSymbols = new Set<string>();
let isRunning = false;

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Log with timestamp
 */
function log(message: string) {
  console.log(`[${new Date().toISOString()}] [MarketSync] ${message}`);
}

/**
 * Map market codes to Yahoo Finance region codes
 */
const marketRegionMap: Record<string, string> = {
  'US': 'US',
  'LONDON': 'GB',
  'TOKYO': 'JP',
  'HONG_KONG': 'HK',
  'FRANKFURT': 'DE',
  'SYDNEY': 'AU',
  'INDIA': 'IN',
  'FOREX': 'FX' // Forex doesn't use region codes, but we'll use FX as identifier
};

/**
 * Fetch and store market movers from all open markets
 * Returns the list of symbols from movers
 */
async function fetchAllMarketMovers(): Promise<string[]> {
  const allSymbols: string[] = [];
  const openMarkets = getOpenMarkets();
  const allMarketsStatus = getAllMarketsStatus();
  
  // Log status of all markets for debugging
  log('Checking market status:');
  allMarketsStatus.forEach(marketInfo => {
    const status = marketInfo.isOpen ? 'OPEN' : 'CLOSED';
    log(`  ${status}: ${marketInfo.name} (${marketInfo.currentTime} ${marketInfo.timeZone.split('/')[1]})`);
  });
  
  if (openMarkets.length === 0) {
    log('No markets are currently open');
    return allSymbols;
  }
  
  log(`Fetching market movers from ${openMarkets.length} open markets: ${openMarkets.join(', ')}`);
  
  // For US market, use the standard market movers API (gainers/losers)
  if (openMarkets.includes('US')) {
    try {
      log('Fetching US market movers (gainers)...');
      const gainers = await getMarketMovers('gainers', 50);
      if (gainers.length > 0) {
        await storeMarketMovers('gainers', gainers);
        await storeTrackedSymbolsFromMovers('gainers', gainers, 'market_movers');
        gainers.forEach(g => allSymbols.push(g.symbol));
        log(`✓ Stored ${gainers.length} US gainers`);
      }
      
      await sleep(CONFIG.API_DELAY_MS);
      
      log('Fetching US market movers (losers)...');
      const losers = await getMarketMovers('losers', 50);
      if (losers.length > 0) {
        await storeMarketMovers('losers', losers);
        await storeTrackedSymbolsFromMovers('losers', losers, 'market_movers');
        losers.forEach(l => allSymbols.push(l.symbol));
        log(`✓ Stored ${losers.length} US losers`);
      }
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [MarketSync] Error fetching US market movers:`, error.message);
    }
  }
  
  // For other markets, fetch trending symbols as market movers
  const otherMarkets = openMarkets.filter(m => m !== 'US');
  if (otherMarkets.length > 0) {
    log(`Processing ${otherMarkets.length} non-US markets: ${otherMarkets.join(', ')}`);
  }
  
  for (const market of openMarkets) {
    if (market === 'US') continue; // Already handled above
    
    try {
      const region = marketRegionMap[market] || 'US';
      const marketConfig = MARKETS[market];
      
      if (!marketConfig) {
        log(`⚠ Warning: Market config not found for ${market}, skipping...`);
        continue;
      }
      
      log(`Fetching trending symbols for ${marketConfig.name} (region: ${region})...`);
      
      const trendingResult = await yahooFinanceInstance.trendingSymbols(region, { count: 30 });
      
      if (trendingResult?.quotes && trendingResult.quotes.length > 0) {
        // Store as trending symbols
        await storeTrendingSymbols(trendingResult.quotes);
        
        // Also store as market movers (use 'gainers' type for trending)
        const movers = trendingResult.quotes.map((quote: any) => ({
          symbol: quote.symbol,
          name: quote.shortName || quote.longName || quote.symbol,
          price: quote.regularMarketPrice || 0,
          changePercent: quote.regularMarketChangePercent || 0,
          volume: quote.regularMarketVolume || 0,
          currency: quote.currency || 'USD'
        }));
        
        // Store as gainers (since we don't have separate gainers/losers for non-US markets)
        await storeMarketMovers('gainers', movers);
        await storeTrackedSymbolsFromMovers('gainers', movers, 'market_movers');
        
        movers.forEach(m => {
          if (m.symbol) allSymbols.push(m.symbol);
        });
        
        log(`✓ Stored ${movers.length} trending symbols from ${marketConfig.name}`);
      } else {
        log(`⚠ No trending symbols returned for ${marketConfig.name}`);
      }
      
      await sleep(CONFIG.API_DELAY_MS);
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [MarketSync] Error fetching trending for ${market}:`, error.message);
      log(`✗ Failed to fetch data for ${market}: ${error.message}`);
    }
  }
  
  // Remove duplicates
  const uniqueSymbols = Array.from(new Set(allSymbols));
  log(`Total unique symbols from all markets: ${uniqueSymbols.length}`);
  return uniqueSymbols;
}

/**
 * Fetch historical data for a single symbol
 * Checks existing data and only fetches what's missing
 */
async function fetchHistoricalForSymbol(symbol: string): Promise<boolean> {
  try {
    // Check existing data range
    const existingRange = await getHistoricalDataRange(symbol);
    
    const endDate = new Date();
    let startDate = new Date();
    startDate.setDate(endDate.getDate() - CONFIG.BACKFILL_DAYS);
    
    // If we have some data, only fetch what's missing
    if (existingRange.count > 0 && existingRange.minDate) {
      // Check if we need older data
      const oneYearAgo = new Date();
      oneYearAgo.setDate(oneYearAgo.getDate() - CONFIG.BACKFILL_DAYS);
      
      if (existingRange.minDate <= oneYearAgo) {
        // We have enough historical data
        log(`${symbol}: Already has ${existingRange.count} records from ${existingRange.minDate.toDateString()}`);
        return true;
      }
      
      // Need to fetch older data - from 1 year ago to earliest existing date
      endDate.setTime(existingRange.minDate.getTime());
      endDate.setDate(endDate.getDate() - 1); // Day before earliest existing
      
      log(`${symbol}: Has data from ${existingRange.minDate.toDateString()}, fetching older data...`);
    } else {
      log(`${symbol}: No historical data found, fetching ${CONFIG.BACKFILL_DAYS} days...`);
    }
    
    // Fetch historical data from Yahoo Finance
    const historicalData = await fetchYahooHistoricalData(symbol, startDate, endDate, '1d');
    
    if (historicalData && historicalData.length > 0) {
      await storeHistoricalData(symbol, historicalData);
      log(`${symbol}: Stored ${historicalData.length} historical records`);
      return true;
    } else {
      log(`${symbol}: No historical data available from Yahoo Finance`);
      return false;
    }
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [MarketSync] Error fetching historical data for ${symbol}:`, error.message);
    return false;
  }
}

/**
 * Process all symbols that need historical backfill
 */
async function backfillHistoricalData(): Promise<void> {
  log('Checking symbols that need historical data backfill...');
  
  // First, get symbols from recent market movers that need backfill
  const symbolsNeedingBackfill = await getSymbolsNeedingBackfill(CONFIG.BACKFILL_DAYS);
  
  if (symbolsNeedingBackfill.length === 0) {
    log('All tracked symbols have sufficient historical data');
    return;
  }
  
  log(`Found ${symbolsNeedingBackfill.length} symbols needing historical data backfill`);
  
  // Process in batches to avoid rate limiting
  let successCount = 0;
  let errorCount = 0;
  const symbolsToProcess = symbolsNeedingBackfill.slice(0, CONFIG.MAX_SYMBOLS_PER_RUN);
  
  for (let i = 0; i < symbolsToProcess.length; i++) {
    const symbol = symbolsToProcess[i];
    
    // Skip if already processed in this session
    if (processedSymbols.has(symbol)) {
      continue;
    }
    
    const success = await fetchHistoricalForSymbol(symbol);
    
    if (success) {
      successCount++;
      processedSymbols.add(symbol);
    } else {
      errorCount++;
    }
    
    // Delay between requests
    await sleep(CONFIG.API_DELAY_MS);
    
    // Every 10 symbols, add extra delay
    if ((i + 1) % 10 === 0) {
      log(`Progress: ${i + 1}/${symbolsToProcess.length} (${successCount} success, ${errorCount} errors)`);
      await sleep(CONFIG.BATCH_DELAY_MS);
    }
  }
  
  log(`Historical backfill complete: ${successCount} success, ${errorCount} errors`);
}

/**
 * Fetch stock quotes for all market mover symbols
 */
async function fetchQuotesForMovers(symbols: string[]): Promise<void> {
  log(`Fetching quotes for ${symbols.length} symbols...`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const symbol of symbols) {
    try {
      const quote = await getStockQuote(symbol);
      await storeStockQuote(quote);
      successCount++;
    } catch (error) {
      errorCount++;
    }
    
    await sleep(100); // Small delay between quote requests
  }
  
  log(`Quotes fetched: ${successCount} success, ${errorCount} errors`);
}

/**
 * Main sync cycle
 */
async function runSyncCycle(): Promise<void> {
  const startTime = Date.now();
  log('='.repeat(60));
  log('Starting sync cycle...');
  
  // Show which markets are open
  const openMarkets = getOpenMarkets();
  const allMarketsStatus = getAllMarketsStatus();
  log(`Markets status: ${openMarkets.length} open, ${allMarketsStatus.length - openMarkets.length} closed`);
  openMarkets.forEach(market => {
    const marketInfo = allMarketsStatus.find(m => m.market === market);
    if (marketInfo) {
      log(`  ✓ ${marketInfo.name} (${marketInfo.currentTime} ${marketInfo.timeZone.split('/')[1]})`);
    }
  });
  
  // 1. Fetch all market movers from all open markets
  const moverSymbols = await fetchAllMarketMovers();
  log(`Got ${moverSymbols.length} unique symbols from all open markets`);
  
  // 2. Fetch quotes for all movers
  if (moverSymbols.length > 0) {
    await sleep(CONFIG.API_DELAY_MS);
    await fetchQuotesForMovers(moverSymbols);
  }
  
  // 3. Backfill historical data for symbols that need it
  await sleep(CONFIG.API_DELAY_MS);
  await backfillHistoricalData();
  
  const duration = Date.now() - startTime;
  log(`Sync cycle complete in ${(duration / 1000).toFixed(2)}s`);
  log('='.repeat(60));
}

/**
 * Start the market data sync job
 */
export async function startMarketDataSync(): Promise<void> {
  if (isRunning) {
    log('Market data sync is already running');
    return;
  }
  
  isRunning = true;
  log('Starting Market Data Sync service...');
  
  // Initialize database
  await initializeClickHouse();
  
  // Run initial sync (only if any market is open)
  const openMarkets = getOpenMarkets();
  if (openMarkets.length > 0) {
    log(`Markets open: ${openMarkets.join(', ')}`);
    await runSyncCycle();
  } else {
    const allMarketsStatus = getAllMarketsStatus();
    const closedMarkets = allMarketsStatus.filter(m => !m.isOpen);
    log(`No markets are open. ${closedMarkets.length} markets are closed. Sync will start when markets open.`);
  }
  
  // Schedule periodic market movers fetch (only when any market is open)
  setInterval(async () => {
    if (!isRunning) return;
    try {
      const openMarkets = getOpenMarkets();
      if (openMarkets.length > 0) {
        log(`Markets open: ${openMarkets.join(', ')}`);
        await fetchAllMarketMovers();
      } else {
        const allMarketsStatus = getAllMarketsStatus();
        const closedCount = allMarketsStatus.filter(m => !m.isOpen).length;
        log(`No markets are open (${closedCount} markets closed)`);
      }
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [MarketSync] Movers fetch error:`, error.message);
    }
  }, CONFIG.MOVERS_INTERVAL_MS);
  
  // Schedule periodic historical data check (runs regardless of market status)
  setInterval(async () => {
    if (!isRunning) return;
    try {
      await backfillHistoricalData();
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [MarketSync] Historical backfill error:`, error.message);
    }
  }, CONFIG.HISTORICAL_CHECK_INTERVAL_MS);
  
  log(`Sync scheduled:
  - Market movers: every ${CONFIG.MOVERS_INTERVAL_MS / 1000}s (from all open markets)
  - Historical backfill: every ${CONFIG.HISTORICAL_CHECK_INTERVAL_MS / 1000}s
  - Backfill target: ${CONFIG.BACKFILL_DAYS} days
  - Supported markets: ${Object.keys(MARKETS).join(', ')}`);

  // Log current tracked symbols count and details
  try {
    const trackedSymbols = await getAllTrackedSymbols();
    log(`Currently tracking ${trackedSymbols.length} symbols`);
    
    // Get detailed info about tracked symbols
    const result = await clickhouseClient.query({
      query: `
        SELECT 
          symbol,
          anyLast(name) as name,
          max(last_seen) as last_seen,
          anyLast(last_type) as last_type,
          anyLast(last_source) as last_source
        FROM ${CLICKHOUSE_CONFIG.database}.tracked_symbols FINAL
        WHERE last_seen >= now() - INTERVAL 7 DAY
        GROUP BY symbol
        ORDER BY last_seen DESC
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });
    const recentSymbols: any = await result.json();
    if (recentSymbols.length > 0) {
      log(`Recent tracked symbols (last 10):`);
      recentSymbols.forEach((s: any) => {
        log(`  - ${s.symbol} (${s.name}): ${s.last_type} from ${s.last_source}, last seen: ${new Date(s.last_seen).toISOString()}`);
      });
    } else {
      log('No tracked symbols found in the last 7 days');
    }
  } catch (error: any) {
    log(`Could not get tracked symbols info: ${error.message}`);
  }
}

/**
 * Stop the market data sync job
 */
export function stopMarketDataSync(): void {
  isRunning = false;
  log('Market Data Sync service stopped');
}

/**
 * Run once - useful for manual backfill
 */
export async function runOnce(): Promise<void> {
  log('Running one-time sync...');
  await initializeClickHouse();
  await runSyncCycle();
  log('One-time sync complete');
}

// Run as standalone script (only when executed directly, not when imported)
// Check if this file is being run directly by checking if it matches the script path
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                      process.argv[1]?.includes('marketDataSync.ts');

if (isMainModule) {
  const args = process.argv.slice(2);
  
  if (args.includes('--once')) {
    // Run once and exit
    runOnce()
      .then(() => {
        log('Exiting...');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Error:', error);
        process.exit(1);
      });
  } else {
    // Run continuously
    startMarketDataSync()
      .then(() => {
        log('Service running. Press Ctrl+C to stop.');
      })
      .catch((error) => {
        console.error('Error starting service:', error);
        process.exit(1);
      });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      log('Received SIGINT, shutting down...');
      stopMarketDataSync();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      log('Received SIGTERM, shutting down...');
      stopMarketDataSync();
      process.exit(0);
    });
  }
}

