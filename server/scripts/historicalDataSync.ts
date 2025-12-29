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
  getMarketMovers as fetchMarketMovers 
} from '../services/yahooFinance';
import { isMarketOpen, getMarketStatus } from '../utils/helpers';

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
 * Fetch top 20 market movers (only when market is closed)
 */
async function fetchMarketMoversWhenClosed(): Promise<void> {
  const marketStatus = getMarketStatus('US');
  
  if (marketStatus.isOpen) {
    log('Market is open, skipping market movers fetch (will fetch when market closes)');
    return;
  }
  
  log('Market is closed, fetching top 20 market movers...');
  
  try {
    // Check if we have historical data for any tracked symbols
    const trackedSymbols = await getAllTrackedSymbols();
    
    if (trackedSymbols.length === 0) {
      log('No tracked symbols found. Fetching market movers to start tracking...');
    } else {
      // Check if we have historical data
      let hasHistoricalData = false;
      for (const symbol of trackedSymbols.slice(0, 5)) { // Check first 5 symbols
        const range = await getHistoricalDataRange(symbol);
        if (range.count > 0) {
          hasHistoricalData = true;
          break;
        }
      }
      
      if (!hasHistoricalData) {
        log('No historical data found yet. Will fetch after historical data sync completes.');
        return;
      }
      
      log('Historical data exists. Proceeding to fetch market movers...');
    }
    
    // Fetch gainers
    log('Fetching top 20 gainers...');
    const gainers = await fetchMarketMovers('gainers', CONFIG.MOVERS_COUNT);
    if (gainers.length > 0) {
      await storeMarketMovers('gainers', gainers);
      await storeTrackedSymbolsFromMovers('gainers', gainers);
      log(`Stored ${gainers.length} gainers`);
    } else {
      log('No gainers data available');
    }
    
    // Delay between requests
    await sleep(CONFIG.API_DELAY_MS);
    
    // Fetch losers
    log('Fetching top 20 losers...');
    const losers = await fetchMarketMovers('losers', CONFIG.MOVERS_COUNT);
    if (losers.length > 0) {
      await storeMarketMovers('losers', losers);
      await storeTrackedSymbolsFromMovers('losers', losers);
      log(`Stored ${losers.length} losers`);
    } else {
      log('No losers data available');
    }
    
    log(`Market movers sync complete: ${gainers.length} gainers, ${losers.length} losers`);
  } catch (err: any) {
    error(`Error fetching market movers: ${err.message}`);
  }
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
    
    // Also check for market movers more frequently when market is closed
    setInterval(async () => {
      const marketStatus = getMarketStatus('US');
      if (!marketStatus.isOpen) {
        await fetchMarketMoversWhenClosed();
      }
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

