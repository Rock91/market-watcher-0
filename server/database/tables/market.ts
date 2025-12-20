/**
 * Market Data Tables
 * 
 * Tables for market movers, trending symbols, and tracked symbols
 */

import { clickhouseClient, CLICKHOUSE_CONFIG } from '../client';

export async function initializeMarketTables(): Promise<void> {
  // Create market_movers table for daily gainers/losers
  await clickhouseClient.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.market_movers (
        timestamp DateTime,
        type LowCardinality(String), -- 'gainers' or 'losers'
        symbol LowCardinality(String),
        name String,
        price Float64,
        change_percent Float64,
        rank UInt32, -- position in the list (1-20)
        INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
      ) ENGINE = MergeTree()
      PARTITION BY toYYYYMMDD(timestamp)
      ORDER BY (type, timestamp, rank)
      TTL timestamp + INTERVAL 30 DAY
    `,
  });

  // Create trending_symbols table
  await clickhouseClient.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.trending_symbols (
        timestamp DateTime,
        symbol LowCardinality(String),
        name String,
        rank UInt32,
        INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
      ) ENGINE = MergeTree()
      PARTITION BY toYYYYMMDD(timestamp)
      ORDER BY (timestamp, rank)
      TTL timestamp + INTERVAL 7 DAY
    `,
  });

  // Create tracked_symbols table (derived from market movers; drives historical backfill)
  await clickhouseClient.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.tracked_symbols (
        symbol LowCardinality(String),
        name String,
        last_source LowCardinality(String), -- e.g. 'market_movers'
        last_type LowCardinality(String),   -- 'gainers' or 'losers'
        last_rank UInt32,
        last_seen DateTime,
        INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
      ) ENGINE = ReplacingMergeTree(last_seen)
      PARTITION BY toYYYYMMDD(last_seen)
      ORDER BY symbol
      TTL last_seen + INTERVAL 30 DAY
    `,
  });

  // Create stock_metadata table for static stock info
  await clickhouseClient.exec({
    query: `
      CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.stock_metadata (
        symbol String,
        name String,
        sector String,
        industry String,
        country String,
        exchange String,
        last_updated DateTime,
        INDEX symbol_idx symbol TYPE bloom_filter GRANULARITY 1
      ) ENGINE = ReplacingMergeTree(last_updated)
      ORDER BY symbol
    `,
  });
}
