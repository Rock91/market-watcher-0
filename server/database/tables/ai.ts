/**
 * AI Trading Tables
 * 
 * Tables for AI strategy results, signals, and trade history
 */

import { clickhouseClient, CLICKHOUSE_CONFIG } from '../client';

export async function initializeAITables(): Promise<void> {
  // Create ai_strategy_results table
  await clickhouseClient.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.ai_strategy_results (
        timestamp DateTime,
        symbol LowCardinality(String),
        strategy LowCardinality(String),
        action LowCardinality(String), -- 'BUY', 'SELL', 'HOLD'
        confidence Float64,
        reason String,
        rsi Nullable(Float64),
        macd Nullable(Float64),
        volatility Nullable(Float64),
        INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
      ) ENGINE = MergeTree()
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (symbol, timestamp, strategy)
      TTL timestamp + INTERVAL 1 YEAR
    `,
  });

  // Create ai_signals table
  await clickhouseClient.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.ai_signals (
        id String,
        timestamp DateTime,
        symbol LowCardinality(String),
        strategy LowCardinality(String),
        action LowCardinality(String), -- 'BUY', 'SELL', 'HOLD'
        confidence Float64,
        reason String,
        status LowCardinality(String), -- 'pending', 'executed', 'cancelled'
        INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
      ) ENGINE = MergeTree()
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (symbol, timestamp)
      TTL timestamp + INTERVAL 1 YEAR
    `,
  });

  // Create trade_history table
  await clickhouseClient.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.trade_history (
        id String,
        timestamp DateTime,
        symbol LowCardinality(String),
        action LowCardinality(String), -- 'BUY', 'SELL'
        price Float64,
        quantity UInt32,
        amount Float64,
        profit Nullable(Float64),
        status LowCardinality(String), -- 'open', 'closed'
        signal_id Nullable(String),
        INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
      ) ENGINE = MergeTree()
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (symbol, timestamp)
      TTL timestamp + INTERVAL 2 YEAR
    `,
  });
}
