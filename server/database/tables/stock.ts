/**
 * Stock Data Tables
 * 
 * Tables for stock quotes and historical data
 */

import { clickhouseClient, CLICKHOUSE_CONFIG } from '../client';

export async function initializeStockTables(): Promise<void> {
  // Create stock_quotes table for time-series price data
  await clickhouseClient.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.stock_quotes (
        timestamp DateTime,
        symbol LowCardinality(String),
        price Float64,
        change Float64,
        change_percent Float64,
        volume UInt64,
        market_cap UInt64,
        pe_ratio Float64,
        day_high Float64,
        day_low Float64,
        previous_close Float64,
        currency LowCardinality(String),
        INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
      ) ENGINE = MergeTree()
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (symbol, timestamp)
      TTL timestamp + INTERVAL 1 YEAR
    `,
  });

  // Create historical_data table for daily OHLCV data
  await clickhouseClient.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.historical_data (
        date Date,
        symbol LowCardinality(String),
        open Float64,
        high Float64,
        low Float64,
        close Float64,
        volume UInt64,
        adj_close Float64,
        fetched_at DateTime DEFAULT now(),
        INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
      ) ENGINE = ReplacingMergeTree(fetched_at)
      PARTITION BY toYYYYMM(date)
      ORDER BY (symbol, date)
      TTL date + INTERVAL 2 YEAR
    `,
  });
}
