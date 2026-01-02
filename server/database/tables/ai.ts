/**
 * AI Trading Tables
 * 
 * Tables for AI strategy results, signals, and trade history
 */

import { clickhouseClient, CLICKHOUSE_CONFIG } from '../client';

export async function initializeAITables(): Promise<void> {
  // Create ai_strategy_results table (stores all strategy runs on all stocks)
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

  // Create ai_signals table (high confidence signals > 75%)
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
