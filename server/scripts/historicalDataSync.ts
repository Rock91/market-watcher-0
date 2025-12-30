/**
 * Historical Data Sync Script
 * 
 * This script:
 * 1. Fetches historical data for the last 6 months for all tracked symbols
 * 2. If data exists, fetches top 20 share movers (gainers & losers) when market is closed
 * 
 * Usage:
 *   npm run sync:historical          - Start continuous sync
 *   npm run sync:historical:once     - Run once and exit
 *   npx tsx server/scripts/historicalDataSync.ts
 */

import 'dotenv/config';
import {
  initializeClickHouse,
  getAllTrackedSymbols,
  getHistoricalDataRange,
  getHistoricalData as getDbHistoricalData,
  storeHistoricalData,
  storeMarketMovers,
  storeTrackedSymbolsFromMovers,
} from '../services/clickhouse';
import { 
  getHistoricalData as fetchYahooHistoricalData, 
  getMarketMovers as fetchMarketMovers,
  getForexQuotes,
  MAJOR_FOREX_PAIRS,
  yahooFinanceInstance 
} from '../services/yahooFinance';
import { isMarketOpen, getMarketStatus, getOpenMarkets, getAllMarketsStatus, MARKETS } from '../utils/helpers';

// Configuration
const CONFIG = {
  // Historical data period (6 months)
  HISTORICAL_MONTHS: 6,
  // Historical data check interval (1 hour)
  HISTORICAL_CHECK_INTERVAL_MS: 60 * 60 * 1000,
  // Market movers fetch interval (30 minutes) - only when market is closed
  MOVERS_CHECK_INTERVAL_MS: 30 * 60 * 1000,
  // Delay between API calls to avoid rate limiting
  API_DELAY_MS: 500,
  // Maximum symbols to process per run
  MAX_SYMBOLS_PER_RUN: 50,
  // Delay between batches
  BATCH_DELAY_MS: 2000,
  // Number of market movers to fetch
  MOVERS_COUNT: 20,
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
  console.log(`[${new Date().toISOString()}] [HistoricalSync] ${message}`);
}

/**
 * Error log
 */
function error(message: string) {
  console.error(`[${new Date().toISOString()}] [HistoricalSync] ERROR: ${message}`);
}

/**
 * Fetch historical data for a single symbol (last 6 months)
 */
async function fetchHistoricalForSymbol(symbol: string): Promise<boolean> {
  try {
    // Check existing data range
    const existingRange = await getHistoricalDataRange(symbol);
    
    const endDate = new Date();
    let startDate = new Date();
    startDate.setMonth(endDate.getMonth() - CONFIG.HISTORICAL_MONTHS);
    
    // If we have some data, only fetch what's missing
    if (existingRange.count > 0 && existingRange.minDate) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - CONFIG.HISTORICAL_MONTHS);
      
      if (existingRange.minDate <= sixMonthsAgo) {
        // We have enough historical data (at least 6 months)
        log(`${symbol}: Already has ${existingRange.count} records from ${existingRange.minDate.toDateString()} (6+ months)`);
        return true;
      }
      
      // Need to fetch older data - from 6 months ago to earliest existing date
      endDate.setTime(existingRange.minDate.getTime());
      endDate.setDate(endDate.getDate() - 1); // Day before earliest existing
      
      log(`${symbol}: Has data from ${existingRange.minDate.toDateString()}, fetching older data to complete 6 months...`);
    } else {
      log(`${symbol}: No historical data found, fetching last ${CONFIG.HISTORICAL_MONTHS} months...`);
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
    error(`Error fetching historical data for ${symbol}: ${error.message}`);
    return false;
  }
}

/**
 * Fetch historical data for all tracked symbols
 */
async function syncHistoricalData(): Promise<void> {
  log('Starting historical data sync (last 6 months)...');
  
  try {
    // Get all tracked symbols
    const trackedSymbols = await getAllTrackedSymbols();
    
    if (trackedSymbols.length === 0) {
      log('No tracked symbols found. Market movers will be fetched first when market is closed.');
      return;
    }
    
    log(`Found ${trackedSymbols.length} tracked symbols`);
    
    // Process in batches to avoid rate limiting
    let successCount = 0;
    let errorCount = 0;
    const symbolsToProcess = trackedSymbols.slice(0, CONFIG.MAX_SYMBOLS_PER_RUN);
    
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
      
      // Every 10 symbols, add extra delay and log progress
      if ((i + 1) % 10 === 0) {
        log(`Progress: ${i + 1}/${symbolsToProcess.length} (${successCount} success, ${errorCount} errors)`);
        await sleep(CONFIG.BATCH_DELAY_MS);
      }
    }
    
    log(`Historical data sync complete: ${successCount} success, ${errorCount} errors`);
  } catch (err: any) {
    error(`Error in historical data sync: ${err.message}`);
  }
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
  'FOREX': 'FX'
};

/**
 * Process a single market: fetch movers and historical data if market is closed
 */
async function processMarket(market: string): Promise<{ moversCount: number; historicalCount: number }> {
  const marketConfig = MARKETS[market];
  if (!marketConfig) {
    return { moversCount: 0, historicalCount: 0 };
  }
  
  const marketStatus = getMarketStatus(market);
  const isOpen = marketStatus.isOpen;
  
  log(`\n[${marketConfig.name}] Status: ${isOpen ? 'OPEN' : 'CLOSED'}`);
  
  // Skip if market is open (other scripts handle open markets)
  if (isOpen) {
    log(`  → Skipping ${marketConfig.name} (market is open)`);
    return { moversCount: 0, historicalCount: 0 };
  }
  
  log(`  → Processing ${marketConfig.name} (market is closed)`);
  
  let moversCount = 0;
  let historicalCount = 0;
  const symbolsToFetchHistorical: string[] = [];
  
  try {
    // Fetch movers based on market type
    if (market === 'US') {
      // US market: fetch gainers and losers
      log(`  → Fetching US market movers (gainers)...`);
      try {
        const gainers = await fetchMarketMovers('gainers', CONFIG.MOVERS_COUNT);
        if (gainers.length > 0) {
          await storeMarketMovers('gainers', gainers);
          await storeTrackedSymbolsFromMovers('gainers', gainers);
          gainers.forEach(g => symbolsToFetchHistorical.push(g.symbol));
          moversCount += gainers.length;
          log(`  ✓ Stored ${gainers.length} US gainers`);
        }
        
        await sleep(CONFIG.API_DELAY_MS);
        
        log(`  → Fetching US market movers (losers)...`);
        const losers = await fetchMarketMovers('losers', CONFIG.MOVERS_COUNT);
        if (losers.length > 0) {
          await storeMarketMovers('losers', losers);
          await storeTrackedSymbolsFromMovers('losers', losers);
          losers.forEach(l => symbolsToFetchHistorical.push(l.symbol));
          moversCount += losers.length;
          log(`  ✓ Stored ${losers.length} US losers`);
        }
      } catch (err: any) {
        error(`  ✗ Error fetching US market movers: ${err.message}`);
      }
    } else if (market === 'FOREX') {
      // Forex market: fetch currency pairs
      log(`  → Fetching forex currency pairs...`);
      try {
        const forexQuotes = await getForexQuotes(MAJOR_FOREX_PAIRS.slice(0, CONFIG.MOVERS_COUNT));
        if (forexQuotes.length > 0) {
          const forexMovers = forexQuotes.map(quote => ({
            symbol: quote.symbol,
            name: quote.name,
            price: quote.price,
            changePercent: quote.changePercent,
            volume: quote.volume,
            currency: quote.currency || 'USD'
          }));
          
          await storeMarketMovers('gainers', forexMovers);
          await storeTrackedSymbolsFromMovers('gainers', forexMovers);
          forexQuotes.forEach(f => symbolsToFetchHistorical.push(f.symbol));
          moversCount += forexQuotes.length;
          log(`  ✓ Stored ${forexQuotes.length} forex currency pairs`);
        }
      } catch (err: any) {
        error(`  ✗ Error fetching forex: ${err.message}`);
      }
    } else {
      // Other markets: fetch trending symbols
      const region = marketRegionMap[market] || 'US';
      log(`  → Fetching trending symbols for ${marketConfig.name}...`);
      try {
        let trendingResult: any = null;
        
        try {
          // Try with validation disabled for regions that may have schema issues
          trendingResult = await yahooFinanceInstance.trendingSymbols(region, { count: CONFIG.MOVERS_COUNT }, { validateResult: false } as any);
        } catch (validationErr: any) {
          // Handle validation errors - data might still be available in error.result
          const errorName = validationErr?.name || validationErr?.constructor?.name || '';
          const isValidationError = errorName.includes('FailedYahooValidationError') || 
                                    errorName.includes('ValidationError') ||
                                    validationErr?.message?.includes('Failed Yahoo Schema validation') ||
                                    validationErr?.message?.includes('Expected an object');
          
          if (isValidationError && validationErr?.result) {
            // Extract data from validation error - data is valid, just schema validation failed
            log(`  ⚠ Schema validation failed for ${marketConfig.name}, but extracting data from error result`);
            trendingResult = validationErr.result;
          } else {
            // Re-throw if it's not a validation error
            throw validationErr;
          }
        }
        
        if (trendingResult?.quotes && trendingResult.quotes.length > 0) {
          const movers = trendingResult.quotes.map((quote: any) => ({
            symbol: quote.symbol,
            name: quote.shortName || quote.longName || quote.symbol,
            price: quote.regularMarketPrice || 0,
            changePercent: quote.regularMarketChangePercent || 0,
            volume: quote.regularMarketVolume || 0,
            currency: quote.currency || 'USD'
          }));
          
          await storeMarketMovers('gainers', movers);
          await storeTrackedSymbolsFromMovers('gainers', movers);
          movers.forEach((m: any) => {
            if (m.symbol) symbolsToFetchHistorical.push(m.symbol);
          });
          moversCount += movers.length;
          log(`  ✓ Stored ${movers.length} trending symbols from ${marketConfig.name}`);
        } else {
          log(`  ⚠ No trending symbols returned for ${marketConfig.name}`);
        }
      } catch (err: any) {
        error(`  ✗ Error fetching trending for ${market}: ${err.message}`);
        // Log more details for debugging
        if (err?.result) {
          log(`  → Error result available but couldn't parse: ${JSON.stringify(err.result).substring(0, 200)}`);
        }
      }
    }
    
    // Fetch historical data for all movers from this market
    if (symbolsToFetchHistorical.length > 0) {
      log(`  → Fetching historical data for ${symbolsToFetchHistorical.length} symbols from ${marketConfig.name}...`);
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const symbol of symbolsToFetchHistorical) {
        try {
          const success = await fetchHistoricalForSymbol(symbol);
          if (success) {
            successCount++;
            historicalCount++;
          } else {
            errorCount++;
          }
          await sleep(CONFIG.API_DELAY_MS);
        } catch (err: any) {
          errorCount++;
          error(`  ✗ Error fetching historical for ${symbol}: ${err.message}`);
        }
      }
      
      log(`  ✓ Historical data: ${successCount} success, ${errorCount} errors`);
    }
    
  } catch (err: any) {
    error(`  ✗ Error processing ${marketConfig.name}: ${err.message}`);
  }
  
  return { moversCount, historicalCount };
}

/**
 * Fetch market movers and historical data for each closed market individually
 */
async function fetchMarketMoversWhenClosed(): Promise<void> {
  const allMarketsStatus = getAllMarketsStatus();
  
  // Show market status
  log('\n' + '='.repeat(60));
  log('Checking market status:');
  allMarketsStatus.forEach(marketInfo => {
    const status = marketInfo.isOpen ? 'OPEN' : 'CLOSED';
    log(`  ${status}: ${marketInfo.name} (${marketInfo.currentTime} ${marketInfo.timeZone.split('/')[1]})`);
  });
  log('='.repeat(60));
  
  let totalMovers = 0;
  let totalHistorical = 0;
  
  // Process each market individually
  for (const market of Object.keys(MARKETS)) {
    const result = await processMarket(market);
    totalMovers += result.moversCount;
    totalHistorical += result.historicalCount;
    
    // Small delay between markets
    await sleep(CONFIG.API_DELAY_MS);
  }
  
  log(`\nMarket processing complete:`);
  log(`  - Total movers fetched: ${totalMovers}`);
  log(`  - Total historical data fetched: ${totalHistorical}`);
  log('='.repeat(60));
}

/**
 * Main sync function
 */
async function runSync(): Promise<void> {
  if (isRunning) {
    log('Sync already running, skipping...');
    return;
  }
  
  isRunning = true;
  
  try {
    // Step 1: Sync historical data (last 6 months)
    await syncHistoricalData();
    
    // Step 2: If market is closed and we have historical data, fetch market movers
    await fetchMarketMoversWhenClosed();
    
    log('Sync cycle complete');
  } catch (err: any) {
    error(`Error in sync cycle: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

/**
 * Main function
 */
async function main() {
  const runOnce = process.argv.includes('--once');
  
  log('='.repeat(60));
  log('Historical Data Sync Script');
  log('='.repeat(60));
  log(`Mode: ${runOnce ? 'Run Once' : 'Continuous'}`);
  log(`Historical Period: Last ${CONFIG.HISTORICAL_MONTHS} months`);
  log(`Market Movers: Top ${CONFIG.MOVERS_COUNT} (only when market is closed)`);
  log('='.repeat(60));
  log('');
  
  // Initialize ClickHouse
  try {
    await initializeClickHouse();
    log('ClickHouse initialized');
  } catch (err: any) {
    error(`ClickHouse initialization failed: ${err.message}`);
    log('Continuing without ClickHouse (some features may not work)');
  }
  
  if (runOnce) {
    // Run once and exit
    await runSync();
    log('Script completed');
    process.exit(0);
  } else {
    // Run continuously
    log('Starting continuous sync...');
    log(`Historical data check interval: ${CONFIG.HISTORICAL_CHECK_INTERVAL_MS / 1000 / 60} minutes`);
    log(`Market movers check interval: ${CONFIG.MOVERS_CHECK_INTERVAL_MS / 1000 / 60} minutes (when market is closed)`);
    log('');
    
    // Run immediately
    await runSync();
    
    // Then run on intervals
    setInterval(async () => {
      await runSync();
    }, CONFIG.HISTORICAL_CHECK_INTERVAL_MS);
    
    // Check each market individually and process closed markets
    setInterval(async () => {
      await fetchMarketMoversWhenClosed();
    }, CONFIG.MOVERS_CHECK_INTERVAL_MS);
    
    log('Continuous sync started. Press Ctrl+C to stop.');
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      log('\nReceived SIGINT, shutting down...');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      log('\nReceived SIGTERM, shutting down...');
      process.exit(0);
    });
  }
}

// Run main function
main().catch((err) => {
  error(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});

