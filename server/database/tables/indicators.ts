/**
 * Technical Indicators Tables
 * 
 * Tables for storing RSI, MACD, and Volatility indicators
 */

import { clickhouseClient, CLICKHOUSE_CONFIG } from '../client';

export async function initializeIndicatorTables(): Promise<void> {
  // Create technical_indicators table for storing RSI, MACD, and Volatility
  await clickhouseClient.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.technical_indicators (
        date Date,
        symbol LowCardinality(String),
        rsi Float64,
        macd_value Float64,
        macd_signal Float64,
        macd_histogram Float64,
        volatility Float64,
        volatility_percent Float64,
        data_points UInt32,
        calculated_at DateTime DEFAULT now(),
        INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1,
        INDEX date_idx date TYPE minmax GRANULARITY 3
      ) ENGINE = ReplacingMergeTree(calculated_at)
      PARTITION BY toYYYYMM(date)
      ORDER BY (symbol, date)
      TTL date + INTERVAL 1 YEAR
    `,
  });
}
