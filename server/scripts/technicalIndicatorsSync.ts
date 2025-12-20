/**
 * Technical Indicators Sync Script
 * 
 * This script:
 * 1. Fetches historical data for tracked symbols
 * 2. Calculates RSI, MACD, and Volatility indicators
 * 3. Stores indicators in ClickHouse database
 * 4. Can be run as a standalone job or integrated into the server
 * 
 * Usage:
 *   npm run sync-indicators
 *   npx tsx server/scripts/technicalIndicatorsSync.ts
 */

import 'dotenv/config';
import {
  initializeClickHouse,
  getAllTrackedSymbols,
  getHistoricalData as getDbHistoricalData,
  storeTechnicalIndicators,
  hasFreshIndicators,
  logScriptStart,
  logScriptEnd,
  storeHistoricalData,
} from '../services/clickhouse';
import { calculateAllIndicators } from '../services/technicalIndicators';
import { getHistoricalData as fetchYahooHistoricalData } from '../services/yahooFinance';

// Configuration
const CONFIG = {
  // Indicators calculation interval (1 hour)
  CALCULATION_INTERVAL_MS: 60 * 60 * 1000,
  // Number of days of historical data to use for calculations
  CALCULATION_DAYS: 30,
  // Delay between symbol processing to avoid rate limiting
  API_DELAY_MS: 500,
  // Maximum symbols to process per run
  MAX_SYMBOLS_PER_RUN: 100,
  // Delay between batches
  BATCH_DELAY_MS: 2000,
  // Maximum age of indicators before recalculating (hours)
  MAX_INDICATOR_AGE_HOURS: 24,
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
  console.log(`[${new Date().toISOString()}] [IndicatorsSync] ${message}`);
}

/**
 * Calculate and store indicators for a single symbol
 */
async function calculateIndicatorsForSymbol(symbol: string): Promise<boolean> {
  try {
    // Check if we already have fresh indicators
    const hasFresh = await hasFreshIndicators(symbol, CONFIG.MAX_INDICATOR_AGE_HOURS);
    if (hasFresh) {
      log(`${symbol}: Indicators are fresh, skipping...`);
      return true;
    }

    log(`${symbol}: Calculating indicators...`);

    // Get historical data (prefer database, fallback to Yahoo Finance)
    let historicalData: any[] = await getDbHistoricalData(symbol, CONFIG.CALCULATION_DAYS);

    // If no data in DB, fetch from Yahoo Finance
    if (!historicalData || historicalData.length === 0) {
      log(`${symbol}: No historical data in DB, fetching from Yahoo Finance...`);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - CONFIG.CALCULATION_DAYS);
      const endDate = new Date();

      historicalData = await fetchYahooHistoricalData(symbol, startDate, endDate, '1d');

      // Store in database for future use
      if (historicalData && historicalData.length > 0) {
        await storeHistoricalData(symbol, historicalData);
        log(`${symbol}: Stored ${historicalData.length} historical records`);
      }
    }

    if (!historicalData || historicalData.length === 0) {
      log(`${symbol}: No historical data available`);
      return false;
    }

    // Sort historical data by date (ascending) to ensure chronological order
    const sortedData = [...historicalData].sort((a: any, b: any) => {
      const dateA = new Date(a.date || a.time || 0);
      const dateB = new Date(b.date || b.time || 0);
      return dateA.getTime() - dateB.getTime();
    });

    // Extract closing prices
    const prices = sortedData
      .map((item: any) => item.close || item.price || 0)
      .filter((price: number) => price > 0);

    if (prices.length < 2) {
      log(`${symbol}: Insufficient data (${prices.length} prices)`);
      return false;
    }

    // Calculate indicators
    const indicators = calculateAllIndicators(prices);

    // Get the latest date from historical data
    const latestDate = sortedData.length > 0
      ? new Date(sortedData[sortedData.length - 1].date || sortedData[sortedData.length - 1].time)
      : new Date();

    // Store indicators
    const indicatorData = {
      date: latestDate,
      symbol: symbol,
      rsi: indicators.rsi,
      macdValue: indicators.macd.value,
      macdSignal: indicators.macd.signal,
      macdHistogram: indicators.macd.histogram,
      volatility: indicators.volatility,
      volatilityPercent: indicators.volatilityPercent,
      dataPoints: prices.length,
    };

    await storeTechnicalIndicators([indicatorData]);

    log(`${symbol}: Stored indicators - RSI: ${indicators.rsi.toFixed(1)}, MACD: ${indicators.macd.value.toFixed(3)}, Volatility: ${indicators.volatilityPercent.toFixed(2)}%`);
    return true;
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [IndicatorsSync] Error calculating indicators for ${symbol}:`, error.message);
    return false;
  }
}

/**
 * Process all tracked symbols
 */
async function processAllSymbols(): Promise<void> {
  log('Fetching tracked symbols...');

  const trackedSymbols = await getAllTrackedSymbols();

  if (trackedSymbols.length === 0) {
    log('No tracked symbols found');
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

    const success = await calculateIndicatorsForSymbol(symbol);

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

  log(`Indicators calculation complete: ${successCount} success, ${errorCount} errors`);
}

/**
 * Main sync cycle
 */
async function runSyncCycle(): Promise<void> {
  const scriptName = 'technical-indicators-sync';
  const startedAt = new Date();

  try {
    log('Starting indicators sync cycle...');
    await logScriptStart(scriptName, { maxSymbols: CONFIG.MAX_SYMBOLS_PER_RUN });

    await processAllSymbols();

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await logScriptEnd(scriptName, startedAt, 'success', undefined, undefined, {
      duration_seconds: Math.round(durationMs / 1000),
    });

    log('Sync cycle complete');
  } catch (error: any) {
    const completedAt = new Date();
    await logScriptEnd(scriptName, startedAt, 'failed', undefined, error.message, {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Start the technical indicators sync job
 */
export async function startIndicatorsSync(): Promise<void> {
  if (isRunning) {
    log('Indicators sync is already running');
    return;
  }

  isRunning = true;
  log('Starting Technical Indicators Sync service...');

  // Initialize database
  await initializeClickHouse();

  // Run initial sync
  await runSyncCycle();

  // Schedule periodic calculation
  setInterval(async () => {
    if (!isRunning) return;
    try {
      await runSyncCycle();
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] [IndicatorsSync] Sync cycle error:`, error.message);
    }
  }, CONFIG.CALCULATION_INTERVAL_MS);

  log(`Sync scheduled: every ${CONFIG.CALCULATION_INTERVAL_MS / 1000 / 60} minutes`);
}

/**
 * Stop the technical indicators sync job
 */
export function stopIndicatorsSync(): void {
  isRunning = false;
  log('Technical Indicators Sync service stopped');
}

/**
 * Run once - useful for manual calculation
 */
export async function runOnce(): Promise<void> {
  log('Running one-time indicators calculation...');
  await initializeClickHouse();
  await runSyncCycle();
  log('One-time calculation complete');
}

// Run as standalone script
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                      process.argv[1]?.includes('technicalIndicatorsSync.ts');

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
    startIndicatorsSync()
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
      stopIndicatorsSync();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      log('Received SIGTERM, shutting down...');
      stopIndicatorsSync();
      process.exit(0);
    });
  }
}
