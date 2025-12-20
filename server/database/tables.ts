/**
 * Database Table Management
 * 
 * Handles table creation and schema management
 */

import { clickhouseClient, CLICKHOUSE_CONFIG } from './client';

// Cache for created per-stock tables to avoid repeated checks
const createdTablesCache = new Set<string>();

/**
 * Create per-stock quotes table if it doesn't exist
 */
export async function ensureStockQuotesTable(symbol: string): Promise<void> {
  const { getStockQuotesTableName } = await import('./utils');
  const tableName = getStockQuotesTableName(symbol);
  const cacheKey = `quotes_${symbol}`;
  
  if (createdTablesCache.has(cacheKey)) {
    return; // Already created in this session
  }

  try {
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${tableName} (
          timestamp DateTime,
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
          INDEX timestamp_idx timestamp TYPE minmax GRANULARITY 3,
          INDEX price_idx price TYPE minmax GRANULARITY 3,
          INDEX volume_idx volume TYPE minmax GRANULARITY 3
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY timestamp
        TTL timestamp + INTERVAL 1 YEAR
      `,
    });
    createdTablesCache.add(cacheKey);
  } catch (error: any) {
    // If table already exists, add to cache anyway
    if (error?.message?.includes('already exists') || error?.code === '57') {
      createdTablesCache.add(cacheKey);
    } else {
      throw error;
    }
  }
}

/**
 * Create per-stock historical data table if it doesn't exist
 */
export async function ensureHistoricalDataTable(symbol: string): Promise<void> {
  const { getHistoricalDataTableName } = await import('./utils');
  const tableName = getHistoricalDataTableName(symbol);
  const cacheKey = `historical_${symbol}`;
  
  if (createdTablesCache.has(cacheKey)) {
    return; // Already created in this session
  }

  try {
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${tableName} (
          date Date,
          open Float64,
          high Float64,
          low Float64,
          close Float64,
          volume UInt64,
          adj_close Float64,
          fetched_at DateTime DEFAULT now(),
          INDEX date_idx date TYPE minmax GRANULARITY 3,
          INDEX close_idx close TYPE minmax GRANULARITY 3,
          INDEX volume_idx volume TYPE minmax GRANULARITY 3,
          INDEX high_idx high TYPE minmax GRANULARITY 3,
          INDEX low_idx low TYPE minmax GRANULARITY 3
        ) ENGINE = ReplacingMergeTree(fetched_at)
        PARTITION BY toYYYYMM(date)
        ORDER BY date
        TTL date + INTERVAL 2 YEAR
      `,
    });
    createdTablesCache.add(cacheKey);
  } catch (error: any) {
    // If table already exists, add to cache anyway
    if (error?.message?.includes('already exists') || error?.code === '57') {
      createdTablesCache.add(cacheKey);
    } else {
      throw error;
    }
  }
}

/**
 * Initialize all database tables
 */
export async function initializeClickHouse(): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] Initializing ClickHouse database at ${CLICKHOUSE_CONFIG.host}:${CLICKHOUSE_CONFIG.port}...`);

    // Test connection first with timeout
    await Promise.race([
      clickhouseClient.ping(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 5 seconds')), 5000)
      )
    ]);
    console.log(`[${new Date().toISOString()}] ClickHouse connection successful`);

    // Create database if it doesn't exist
    try {
      await clickhouseClient.exec({
        query: `CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}`,
      });
      console.log(`[${new Date().toISOString()}] Database '${CLICKHOUSE_CONFIG.database}' created or already exists`);
    } catch (dbError: any) {
      console.warn(`[${new Date().toISOString()}] Database creation warning:`, dbError.message);
    }

    // Import and initialize all table schemas
    const { initializeStockTables } = await import('./tables/stock');
    const { initializeMarketTables } = await import('./tables/market');
    const { initializeIndicatorTables } = await import('./tables/indicators');
    const { initializeAITables } = await import('./tables/ai');
    const { initializeSystemTables } = await import('./tables/system');

    await initializeStockTables();
    await initializeMarketTables();
    await initializeIndicatorTables();
    await initializeAITables();
    await initializeSystemTables();

    console.log(`[${new Date().toISOString()}] ClickHouse database initialized successfully`);
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.warn(`[${new Date().toISOString()}] ClickHouse initialization failed (server will continue without database):`, errorMsg);
    // Don't throw error - allow server to continue without ClickHouse
  }
}
