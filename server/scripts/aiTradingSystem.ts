/**
 * AI Trading System - Complete AI Trading Solution
 * 
 * This script handles:
 * - Creating AI trading tables if they don't exist
 * - Running all AI strategies on all tracked stocks every 30 seconds
 * - Creating AI signals when confidence > 75%
 * - Executing trades automatically
 * - Tracking all trades and P/L
 * 
 * Usage:
 *   npm run ai:trading          - Start continuous trading (runs every 30 seconds)
 *   npm run ai:trading:once     - Run once and exit
 *   npx tsx server/scripts/aiTradingSystem.ts
 */

import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllTrackedSymbols,
  getHistoricalData,
  getLatestStockQuote,
  storeAIStrategyResult,
  storeAISignal,
  storeTrade,
  getPendingAISignals,
  getOpenTrades,
  clickhouseClient,
  type AIStrategyResult,
  type AISignal,
  type Trade,
} from '../services/clickhouse';
import { CLICKHOUSE_CONFIG } from '../config/database';
import {
  generateAISignal,
  type MarketData,
  type TradingSignal,
} from '../services/ai-strategies';

// All available strategies
const STRATEGIES = ['neuro-scalp', 'deep-momentum', 'sentiment-flow'];

// Configuration
const CONFIDENCE_THRESHOLD = 75;
const MIN_INVESTMENT = 100; // Minimum investment amount
const MAX_INVESTMENT = 10000; // Maximum investment amount
const RISK_PERCENT = 0.02; // 2% of balance per trade
const RUN_INTERVAL = 30000; // 30 seconds

let isRunning = false;
let balance = 100000; // Starting balance (virtual trading)

// Logging helpers
function log(message: string) {
  console.log(`[${new Date().toISOString()}] [AI Trading] ${message}`);
}

function error(message: string) {
  console.error(`[${new Date().toISOString()}] [AI Trading] ERROR: ${message}`);
}

// Create AI trading tables if they don't exist
async function ensureAITables(): Promise<void> {
  try {
    log('Ensuring AI trading tables exist...');

    // Create AI strategy results table
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.ai_strategy_results (
          timestamp DateTime,
          symbol LowCardinality(String),
          strategy LowCardinality(String),
          action LowCardinality(String),
          confidence Float64,
          reason String,
          price Float64,
          rsi Nullable(Float64),
          macd Nullable(Float64),
          bb_upper Nullable(Float64),
          bb_middle Nullable(Float64),
          bb_lower Nullable(Float64),
          sma20 Nullable(Float64),
          sma50 Nullable(Float64),
          ema12 Nullable(Float64),
          ema26 Nullable(Float64),
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1,
          INDEX strategy_idx strategy TYPE bloom_filter GRANULARITY 1,
          INDEX confidence_idx confidence TYPE minmax GRANULARITY 3,
          INDEX timestamp_idx timestamp TYPE minmax GRANULARITY 3
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (symbol, timestamp, strategy)
        TTL timestamp + INTERVAL 30 DAY
      `,
    });
    log('✓ ai_strategy_results table ready');

    // Create AI signals table
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.ai_signals (
          signal_id String,
          timestamp DateTime,
          symbol LowCardinality(String),
          strategy LowCardinality(String),
          action LowCardinality(String),
          confidence Float64,
          reason String,
          price Float64,
          status LowCardinality(String),
          executed_at Nullable(DateTime),
          trade_id Nullable(String),
          updated_at DateTime DEFAULT now(),
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1,
          INDEX status_idx status TYPE bloom_filter GRANULARITY 1,
          INDEX confidence_idx confidence TYPE minmax GRANULARITY 3
        ) ENGINE = ReplacingMergeTree(updated_at)
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (symbol, timestamp)
        TTL timestamp + INTERVAL 90 DAY
      `,
    });
    log('✓ ai_signals table ready');

    // Create trade history table
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.trade_history (
          trade_id String,
          signal_id String,
          timestamp DateTime,
          symbol LowCardinality(String),
          action LowCardinality(String),
          strategy LowCardinality(String),
          entry_price Float64,
          quantity UInt32,
          investment_amount Float64,
          confidence Float64,
          exit_price Nullable(Float64),
          exit_timestamp Nullable(DateTime),
          profit_loss Nullable(Float64),
          profit_loss_percent Nullable(Float64),
          status LowCardinality(String),
          reason String,
          updated_at DateTime DEFAULT now(),
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1,
          INDEX status_idx status TYPE bloom_filter GRANULARITY 1,
          INDEX timestamp_idx timestamp TYPE minmax GRANULARITY 3
        ) ENGINE = ReplacingMergeTree(updated_at)
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (symbol, timestamp)
        TTL timestamp + INTERVAL 1 YEAR
      `,
    });
    log('✓ trade_history table ready');

    log('All AI trading tables are ready');
  } catch (err: any) {
    error(`Failed to create AI tables: ${err.message}`);
    throw err;
  }
}

// Calculate investment amount based on confidence
function calculateInvestment(confidence: number, currentPrice: number): { amount: number; quantity: number } {
  // Higher confidence = higher investment (up to max)
  const confidenceMultiplier = confidence / 100;
  const baseAmount = balance * RISK_PERCENT;
  const investmentAmount = Math.min(
    MAX_INVESTMENT,
    Math.max(MIN_INVESTMENT, baseAmount * confidenceMultiplier)
  );
  
  const quantity = Math.floor(investmentAmount / currentPrice);
  return {
    amount: quantity * currentPrice,
    quantity,
  };
}

// Execute a trade based on AI signal
async function executeTrade(signal: AISignal): Promise<Trade | null> {
  try {
    const { symbol, action, confidence, price, strategy, reason, signalId } = signal;

    // Only execute BUY or SELL (not HOLD)
    if (action !== 'BUY' && action !== 'SELL') {
      return null;
    }

    // Check if we have enough balance for BUY
    if (action === 'BUY') {
      const { amount } = calculateInvestment(confidence, price);
      if (amount > balance) {
        log(`Insufficient balance for ${symbol} BUY: need ${amount.toFixed(2)}, have ${balance.toFixed(2)}`);
        return null;
      }
    }

    // Check if we have open position for SELL
    if (action === 'SELL') {
      const openTrades = await getOpenTrades(symbol);
      const buyTrades = openTrades.filter(t => t.action === 'BUY');
      if (buyTrades.length === 0) {
        log(`No open BUY position for ${symbol} SELL signal`);
        return null;
      }
    }

    const tradeId = uuidv4();
    const timestamp = new Date();
    const { amount, quantity } = calculateInvestment(confidence, price);

    const trade: Trade = {
      tradeId,
      signalId,
      timestamp,
      symbol,
      action,
      strategy,
      entryPrice: price,
      quantity,
      investmentAmount: amount,
      confidence,
      status: 'open',
      reason: `AI ${strategy} signal with ${confidence.toFixed(1)}% confidence`,
    };

    // Update balance
    if (action === 'BUY') {
      balance -= amount;
    } else if (action === 'SELL') {
      // For SELL, we'll close the matching BUY trade
      const openTrades = await getOpenTrades(symbol);
      const buyTrade = openTrades.find(t => t.action === 'BUY');
      if (buyTrade) {
        const profitLoss = (price - buyTrade.entryPrice) * buyTrade.quantity;
        const profitLossPercent = ((price - buyTrade.entryPrice) / buyTrade.entryPrice) * 100;
        
        // Update the buy trade to closed
        const closedTrade: Trade = {
          ...buyTrade,
          exitPrice: price,
          exitTimestamp: timestamp,
          profitLoss,
          profitLossPercent,
          status: 'closed',
        };
        
        await storeTrade(closedTrade);
        balance += buyTrade.investmentAmount + profitLoss;
        
        log(`Closed ${symbol} BUY trade: Entry ${buyTrade.entryPrice.toFixed(2)}, Exit ${price.toFixed(2)}, P/L ${profitLoss.toFixed(2)} (${profitLossPercent.toFixed(2)}%)`);
      }
    }

    await storeTrade(trade);
    
    // Update signal status
    const updatedSignal: AISignal = {
      ...signal,
      status: 'executed',
      executedAt: timestamp,
      tradeId,
    };
    await storeAISignal(updatedSignal);

    log(`Executed ${action} trade for ${symbol}: ${quantity} shares @ ${price.toFixed(2)}, Investment: ${amount.toFixed(2)}, Balance: ${balance.toFixed(2)}`);
    
    return trade;
  } catch (err: any) {
    error(`Failed to execute trade for ${signal.symbol}: ${err.message}`);
    return null;
  }
}

// Process a single symbol with all strategies
async function processSymbol(symbol: string): Promise<void> {
  try {
    // Get historical data
    const historicalData = await getHistoricalData(symbol, 50);
    if (!historicalData || historicalData.length < 20) {
      log(`Insufficient data for ${symbol}, skipping...`);
      return;
    }

    // Get current price
    const latestQuote = await getLatestStockQuote(symbol);
    if (!latestQuote) {
      log(`No price data for ${symbol}, skipping...`);
      return;
    }

    const currentPrice = latestQuote.price || 0;
    if (currentPrice === 0) {
      log(`Invalid price for ${symbol}, skipping...`);
      return;
    }

    const historicalPrices = historicalData.map((d: any) => d.close || d.price || 0).filter((p: number) => p > 0);
    if (historicalPrices.length < 20) {
      log(`Insufficient price history for ${symbol}, skipping...`);
      return;
    }

    const marketData: MarketData = {
      symbol,
      price: currentPrice,
      volume: latestQuote.volume || 0,
      historicalPrices,
      timestamp: Date.now(),
    };

    // Run all strategies
    for (const strategy of STRATEGIES) {
      try {
        // Generate sentiment score (mock for now, can be enhanced with real sentiment API)
        const sentimentScore = (Math.random() - 0.5) * 2; // -1 to 1

        const signal: TradingSignal = generateAISignal(marketData, strategy, sentimentScore);

        // Store strategy result
        const result: AIStrategyResult = {
          timestamp: new Date(),
          symbol,
          strategy,
          action: signal.action,
          confidence: signal.confidence,
          reason: signal.reason,
          price: currentPrice,
          technicalIndicators: signal.technicalIndicators,
        };

        await storeAIStrategyResult(result);

        // If confidence > threshold, create AI signal
        if (signal.confidence > CONFIDENCE_THRESHOLD && (signal.action === 'BUY' || signal.action === 'SELL')) {
          const signalId = uuidv4();
          const aiSignal: AISignal = {
            signalId,
            timestamp: new Date(),
            symbol,
            strategy,
            action: signal.action,
            confidence: signal.confidence,
            reason: signal.reason,
            price: currentPrice,
            status: 'pending',
          };

          await storeAISignal(aiSignal);
          log(`High confidence signal for ${symbol}: ${signal.action} @ ${currentPrice.toFixed(2)} with ${signal.confidence.toFixed(1)}% confidence (${strategy})`);

          // Execute trade immediately
          await executeTrade(aiSignal);
        }
      } catch (err: any) {
        error(`Failed to process ${strategy} for ${symbol}: ${err.message}`);
      }
    }
  } catch (err: any) {
    error(`Failed to process symbol ${symbol}: ${err.message}`);
  }
}

// Process all tracked symbols
async function processAllSymbols(): Promise<void> {
  try {
    log('Starting AI strategy analysis...');
    
    const symbols = await getAllTrackedSymbols();
    log(`Processing ${symbols.length} symbols with ${STRATEGIES.length} strategies each...`);

    let processed = 0;
    let signalsGenerated = 0;
    let tradesExecuted = 0;

    for (const symbol of symbols) {
      try {
        await processSymbol(symbol);
        processed++;
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err: any) {
        error(`Error processing ${symbol}: ${err.message}`);
      }
    }

    // Check for pending signals that need execution
    const pendingSignals = await getPendingAISignals(50);
    for (const signal of pendingSignals) {
      try {
        await executeTrade(signal);
        tradesExecuted++;
      } catch (err: any) {
        error(`Error executing pending signal ${signal.signalId}: ${err.message}`);
      }
    }

    log(`Completed: ${processed} symbols processed, ${signalsGenerated} signals generated, ${tradesExecuted} trades executed, Balance: ${balance.toFixed(2)}`);
  } catch (err: any) {
    error(`Failed to process all symbols: ${err.message}`);
  }
}

// Main execution function
export async function runOnce(): Promise<void> {
  if (isRunning) {
    log('Already running, skipping...');
    return;
  }

  isRunning = true;
  try {
    // Ensure tables exist first
    await ensureAITables();
    
    // Process all symbols
    await processAllSymbols();
  } catch (err: any) {
    error(`Run failed: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

// Start continuous trading system
export function startAITradingSystem(): void {
  if (isRunning) {
    log('AI Trading System already running');
    return;
  }

  log('='.repeat(60));
  log('AI Trading System Starting');
  log('='.repeat(60));
  log(`Strategies: ${STRATEGIES.join(', ')}`);
  log(`Confidence Threshold: ${CONFIDENCE_THRESHOLD}%`);
  log(`Run Interval: ${RUN_INTERVAL / 1000} seconds`);
  log(`Starting Balance: ${balance.toFixed(2)}`);
  log('='.repeat(60));

  // Initial run
  setTimeout(() => {
    runOnce();
  }, 5000); // Wait 5 seconds after startup

  // Set up interval
  setInterval(() => {
    if (!isRunning) {
      runOnce();
    }
  }, RUN_INTERVAL);

  log('AI Trading System started successfully');
}

// Stop the trading system
export function stopAITradingSystem(): void {
  isRunning = false;
  log('AI Trading System stopped');
}

// Run if executed directly
runOnce()
  .then(() => {
    if (process.argv.includes('--once')) {
      log('AI Trading System run completed');
      process.exit(0);
    } else {
      // Start continuous mode after first run
      startAITradingSystem();
    }
  })
  .catch((err) => {
    error(`Unhandled error: ${err.message}`);
    console.error(err);
    process.exit(1);
  });
