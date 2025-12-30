/**
 * Data Sync Script - Runs every 5 minutes
 * 
 * This script syncs market data every 5 minutes:
 * 1. Fetches market movers from all open markets
 * 2. Fetches trending symbols from open markets
 * 3. Fetches stock quotes for active symbols
 * 4. Stores all data in ClickHouse
 * 
 * Usage:
 *   npm run sync:5min
 *   npx tsx server/scripts/dataSync5min.ts
 *   npx tsx server/scripts/dataSync5min.ts --once
 */

import 'dotenv/config';
import { 
  getMarketMovers, 
  getStockQuote,
  getForexQuotes,
  MAJOR_FOREX_PAIRS,
  getTrendingSymbols
} from '../services/yahooFinance';
import {
  initializeClickHouse,
  storeStockQuote,
  storeStockQuotes,
  storeMarketMovers,
  storeTrackedSymbolsFromMovers,
  storeTrendingSymbols,
  clickhouseClient,
} from '../services/clickhouse';
import { CLICKHOUSE_CONFIG } from '../config/database';
import { getOpenMarkets, getAllMarketsStatus, MARKETS, isMarketOpen } from '../utils/helpers';

// Configuration
const CONFIG = {
  // Sync interval (5 minutes)
  SYNC_INTERVAL_MS: 5 * 60 * 1000,
  // Delay between API calls to avoid rate limiting
  API_DELAY_MS: 500,
  // Maximum symbols to fetch quotes for per sync
  MAX_QUOTES_PER_SYNC: 100,
};

// Track processed symbols to avoid duplicates
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
  console.log(`[${new Date().toISOString()}] [DataSync5min] ${message}`);
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
 * Fetch market movers from all open markets
 */
async function fetchMarketMoversFromOpenMarkets(): Promise<string[]> {
  const allSymbols: string[] = [];
  const openMarkets = getOpenMarkets();
  
  if (openMarkets.length === 0) {
    log('No markets are currently open');
    return allSymbols;
  }
  
  log(`Fetching market movers from ${openMarkets.length} open markets: ${openMarkets.join(', ')}`);
  
  // For US market, use the standard market movers API
  if (openMarkets.includes('US')) {
    try {
      log('Fetching US market movers (gainers)...');
      const gainers = await getMarketMovers('gainers', 30);
      if (gainers.length > 0) {
        await storeMarketMovers('gainers', gainers);
        await storeTrackedSymbolsFromMovers('gainers', gainers, 'market_movers');
        gainers.forEach(g => allSymbols.push(g.symbol));
        log(`✓ Stored ${gainers.length} US gainers`);
      }
      
      await sleep(CONFIG.API_DELAY_MS);
      
      log('Fetching US market movers (losers)...');
      const losers = await getMarketMovers('losers', 30);
      if (losers.length > 0) {
        await storeMarketMovers('losers', losers);
        await storeTrackedSymbolsFromMovers('losers', losers, 'market_movers');
        losers.forEach(l => allSymbols.push(l.symbol));
        log(`✓ Stored ${losers.length} US losers`);
      }
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [DataSync5min] Error fetching US market movers:`, error.message);
    }
  }
  
  // For other markets, try to get trending symbols as market movers
  for (const market of openMarkets) {
    if (market === 'US') continue; // Already handled above
    
    try {
      const region = marketRegionMap[market] || 'US';
      const marketConfig = MARKETS[market];
      
      log(`Fetching trending symbols for ${marketConfig.name}...`);
      
      let trendingResult: any = null;
      
      try {
        // Try with validation disabled for regions that may have schema issues
        trendingResult = await yahooFinanceInstance.trendingSymbols(region, { count: 20 }, { validateResult: false } as any);
      } catch (validationErr: any) {
        // Handle validation errors - data might still be available in error.result
        const errorName = validationErr?.name || validationErr?.constructor?.name || '';
        const isValidationError = errorName.includes('FailedYahooValidationError') || 
                                  errorName.includes('ValidationError') ||
                                  validationErr?.message?.includes('Failed Yahoo Schema validation') ||
                                  validationErr?.message?.includes('Expected an object');
        
        if (isValidationError && validationErr?.result) {
          // Extract data from validation error - data is valid, just schema validation failed
          log(`⚠ Schema validation failed for ${marketConfig.name}, but extracting data from error result`);
          trendingResult = validationErr.result;
        } else {
          // Re-throw if it's not a validation error
          throw validationErr;
        }
      }
      
      if (trendingResult?.quotes && trendingResult.quotes.length > 0) {
        // Store as trending symbols
        await storeTrendingSymbols(trendingResult.quotes);
        
        // Extract symbols
        trendingResult.quotes.forEach((quote: any) => {
          if (quote.symbol) {
            allSymbols.push(quote.symbol);
          }
        });
        
        log(`✓ Stored ${trendingResult.quotes.length} trending symbols from ${marketConfig.name}`);
      }
      
      await sleep(CONFIG.API_DELAY_MS);
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [DataSync5min] Error fetching trending for ${market}:`, error.message);
    }
  }
  
  // Remove duplicates
  const uniqueSymbols = Array.from(new Set(allSymbols));
  log(`Total unique symbols collected: ${uniqueSymbols.length}`);
  
  return uniqueSymbols;
}

/**
 * Fetch trending symbols from all open markets
 */
async function fetchTrendingFromOpenMarkets(): Promise<void> {
  const openMarkets = getOpenMarkets();
  
  if (openMarkets.length === 0) {
    log('No markets are currently open, skipping trending fetch');
    return;
  }
  
  log(`Fetching trending symbols from ${openMarkets.length} open markets...`);
  
  for (const market of openMarkets) {
    try {
      const region = marketRegionMap[market] || 'US';
      const marketConfig = MARKETS[market];
      
      log(`Fetching trending symbols for ${marketConfig.name}...`);
      
      let trendingResult: any = null;
      
      try {
        // Try with validation disabled for regions that may have schema issues
        trendingResult = await yahooFinanceInstance.trendingSymbols(region, { count: 20 }, { validateResult: false } as any);
      } catch (validationErr: any) {
        // Handle validation errors - data might still be available in error.result
        const errorName = validationErr?.name || validationErr?.constructor?.name || '';
        const isValidationError = errorName.includes('FailedYahooValidationError') || 
                                  errorName.includes('ValidationError') ||
                                  validationErr?.message?.includes('Failed Yahoo Schema validation') ||
                                  validationErr?.message?.includes('Expected an object');
        
        if (isValidationError && validationErr?.result) {
          // Extract data from validation error - data is valid, just schema validation failed
          log(`⚠ Schema validation failed for ${marketConfig.name}, but extracting data from error result`);
          trendingResult = validationErr.result;
        } else {
          // Re-throw if it's not a validation error
          throw validationErr;
        }
      }
      
      if (trendingResult?.quotes && trendingResult.quotes.length > 0) {
        await storeTrendingSymbols(trendingResult.quotes);
        log(`✓ Stored ${trendingResult.quotes.length} trending symbols from ${marketConfig.name}`);
      }
      
      await sleep(CONFIG.API_DELAY_MS);
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [DataSync5min] Error fetching trending for ${market}:`, error.message);
    }
  }
}

/**
 * Fetch stock quotes for symbols
 */
async function fetchStockQuotes(symbols: string[]): Promise<void> {
  if (symbols.length === 0) {
    return;
  }
  
  // Limit the number of quotes to fetch per sync
  const symbolsToFetch = symbols.slice(0, CONFIG.MAX_QUOTES_PER_SYNC);
  
  log(`Fetching quotes for ${symbolsToFetch.length} symbols...`);
  
  const quotes: any[] = [];
  let successCount = 0;
  let errorCount = 0;
  
  for (const symbol of symbolsToFetch) {
    try {
      const quote = await getStockQuote(symbol);
      quotes.push(quote);
      successCount++;
      
      // Small delay to avoid rate limiting
      await sleep(100);
    } catch (error: any) {
      errorCount++;
      // Don't log each error to avoid spam
    }
  }
  
  // Batch insert quotes
  if (quotes.length > 0) {
    await storeStockQuotes(quotes);
    log(`✓ Stored ${quotes.length} stock quotes (${successCount} success, ${errorCount} errors)`);
  }
}

/**
 * Main sync cycle
 */
async function runSyncCycle(): Promise<void> {
  const startTime = Date.now();
  log('='.repeat(60));
  log('Starting 5-minute sync cycle...');
  
  try {
    // Get open markets status
    const allMarketsStatus = getAllMarketsStatus();
    const openMarkets = allMarketsStatus.filter(m => m.isOpen);
    
    log(`Markets status: ${openMarkets.length} open, ${allMarketsStatus.length - openMarkets.length} closed`);
    openMarkets.forEach(m => {
      log(`  ✓ ${m.name} (${m.currentTime} ${m.timeZone.split('/')[1]})`);
    });
    
    if (openMarkets.length === 0) {
      log('No markets are open. Skipping sync cycle.');
      log('='.repeat(60));
      return;
    }
    
    // 1. Fetch market movers and trending from open markets
    const symbols = await fetchMarketMoversFromOpenMarkets();
    
    // 2. Fetch additional trending symbols
    await fetchTrendingFromOpenMarkets();
    
    // 3. Fetch forex quotes if forex market is open
    const openMarketCodes = openMarkets.map(m => m.market);
    if (openMarketCodes.includes('FOREX')) {
      try {
        log('Fetching forex currency pairs...');
        const forexQuotes = await getForexQuotes(MAJOR_FOREX_PAIRS.slice(0, 20));
        if (forexQuotes.length > 0) {
          await storeStockQuotes(forexQuotes);
          forexQuotes.forEach(f => symbols.push(f.symbol));
          log(`✓ Fetched ${forexQuotes.length} forex currency pairs`);
        }
      } catch (error: any) {
        log(`✗ Failed to fetch forex data: ${error.message}`);
      }
    }
    
    // 4. Fetch stock quotes for collected symbols
    if (symbols.length > 0) {
      await fetchStockQuotes(symbols);
    }
    
    const duration = Date.now() - startTime;
    log(`Sync cycle complete in ${(duration / 1000).toFixed(2)}s`);
    log(`Processed ${symbols.length} unique symbols`);
    log('='.repeat(60));
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${new Date().toISOString()}] [DataSync5min] Sync cycle error after ${(duration / 1000).toFixed(2)}s:`, error.message);
    log('='.repeat(60));
  }
}

/**
 * Start the 5-minute data sync job
 */
export async function startDataSync5min(): Promise<void> {
  if (isRunning) {
    log('Data sync is already running');
    return;
  }
  
  isRunning = true;
  log('Starting 5-Minute Data Sync service...');
  
  // Initialize database
  await initializeClickHouse();
  
  // Run initial sync
  await runSyncCycle();
  
  // Schedule periodic sync every 5 minutes
  setInterval(async () => {
    if (!isRunning) return;
    try {
      await runSyncCycle();
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [DataSync5min] Sync cycle error:`, error.message);
    }
  }, CONFIG.SYNC_INTERVAL_MS);
  
  log(`Sync scheduled: every ${CONFIG.SYNC_INTERVAL_MS / 1000 / 60} minutes`);
  
  // Log tracked symbols count
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT count(*) as count
        FROM ${CLICKHOUSE_CONFIG.database}.tracked_symbols FINAL
        WHERE last_seen >= now() - INTERVAL 24 HOUR
      `,
      format: 'JSONEachRow',
    });
    const data: any = await result.json();
    const count = data[0]?.count || 0;
    log(`Currently tracking ${count} symbols (last 24 hours)`);
  } catch (error: any) {
    log(`Could not get tracked symbols count: ${error.message}`);
  }
}

/**
 * Stop the 5-minute data sync job
 */
export function stopDataSync5min(): void {
  isRunning = false;
  log('5-Minute Data Sync service stopped');
}

/**
 * Run once - useful for manual sync
 */
export async function runOnce(): Promise<void> {
  log('Running one-time sync...');
  await initializeClickHouse();
  await runSyncCycle();
  log('One-time sync complete');
}

// Run as standalone script (only when executed directly, not when imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                      process.argv[1]?.includes('dataSync5min.ts');

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
    startDataSync5min()
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
      stopDataSync5min();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      log('Received SIGTERM, shutting down...');
      stopDataSync5min();
      process.exit(0);
    });
  }
}

