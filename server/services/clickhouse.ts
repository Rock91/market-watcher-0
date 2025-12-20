import { createClient } from '@clickhouse/client';
import { CLICKHOUSE_CONFIG } from '../config/database';

// Determine protocol based on port (8443 is HTTPS for ClickHouse Cloud)
const isSecurePort = CLICKHOUSE_CONFIG.port === '8443' || CLICKHOUSE_CONFIG.port === '9440';
const protocol = isSecurePort ? 'https' : 'http';

// Create client without database first (we'll create the database in initialization)
// Use 'default' database for initial connection
export const clickhouseClient = createClient({
  url: `${protocol}://${CLICKHOUSE_CONFIG.host}:${CLICKHOUSE_CONFIG.port}`,
  username: CLICKHOUSE_CONFIG.username,
  password: CLICKHOUSE_CONFIG.password,
  database: 'default', // Use default database initially
  request_timeout: 10000, // 10 second timeout for cloud connections
  max_open_connections: 10,
});

// Cache for created per-stock tables to avoid repeated checks
const createdTablesCache = new Set<string>();

/**
 * Convert JavaScript Date to ClickHouse DateTime string format
 * ClickHouse expects: 'YYYY-MM-DD HH:MM:SS'
 */
function dateToClickHouseDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
}

// Sanitize symbol name for use in table name (ClickHouse table names must be valid identifiers)
function sanitizeTableName(symbol: string): string {
  // Replace invalid characters with underscore, ensure it starts with a letter or number
  const sanitized = symbol.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
  // Ensure it starts with a letter (prepend 'T' if it starts with a number)
  return /^[0-9]/.test(sanitized) ? `T${sanitized}` : sanitized;
}

// Get table name for stock quotes
function getStockQuotesTableName(symbol: string): string {
  return `${CLICKHOUSE_CONFIG.database}.${sanitizeTableName(symbol)}_quotes`;
}

// Get table name for historical data
function getHistoricalDataTableName(symbol: string): string {
  return `${CLICKHOUSE_CONFIG.database}.${sanitizeTableName(symbol)}_historical`;
}

// Create per-stock quotes table if it doesn't exist
async function ensureStockQuotesTable(symbol: string): Promise<void> {
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

// Create per-stock historical data table if it doesn't exist
async function ensureHistoricalDataTable(symbol: string): Promise<void> {
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

// Initialize database and tables
export async function initializeClickHouse() {
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

    // Create database if it doesn't exist (using default database connection)
    try {
      await clickhouseClient.exec({
        query: `CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}`,
      });
      console.log(`[${new Date().toISOString()}] Database '${CLICKHOUSE_CONFIG.database}' created or already exists`);
    } catch (dbError: any) {
      // If database creation fails, log but continue (might already exist or permission issue)
      console.warn(`[${new Date().toISOString()}] Database creation warning:`, dbError.message);
      // Try to verify database exists by querying it
      try {
        await clickhouseClient.query({
          query: `SELECT 1 FROM system.databases WHERE name = '${CLICKHOUSE_CONFIG.database}'`,
        });
      } catch (verifyError) {
        throw new Error(`Database '${CLICKHOUSE_CONFIG.database}' does not exist and could not be created: ${dbError.message}`);
      }
    }

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

    // Create script_execution_log table for tracking script runs
    // Using ReplacingMergeTree with updated_at to allow updates
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.script_execution_log (
          script_name LowCardinality(String),
          status LowCardinality(String), -- 'success', 'failed', 'running'
          started_at DateTime,
          completed_at Nullable(DateTime),
          duration_ms Nullable(UInt64), -- Duration in milliseconds
          rows_affected Nullable(UInt64),
          error_message Nullable(String),
          metadata Nullable(String), -- JSON string for additional info
          updated_at DateTime DEFAULT now()
        ) ENGINE = ReplacingMergeTree(updated_at)
        PARTITION BY toYYYYMM(started_at)
        ORDER BY (script_name, started_at)
        TTL started_at + INTERVAL 1 YEAR
      `,
    });

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

    // Create AI strategy results table (stores all strategy runs on all stocks)
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

    // Create AI signals table (high confidence signals > 75%)
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

    // Best-effort: apply optimizations to existing tables (safe to ignore failures)
    const tryExec = async (query: string) => {
      try {
        await clickhouseClient.exec({ query });
      } catch (e: any) {
        // Don't fail server startup over optional optimizations
        console.warn(`[${new Date().toISOString()}] ClickHouse optimization skipped: ${e?.message || e}`);
      }
    };

    // LowCardinality columns reduce memory/IO for repetitive strings (symbol/type/currency)
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.stock_quotes MODIFY COLUMN symbol LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.stock_quotes MODIFY COLUMN currency LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.market_movers MODIFY COLUMN type LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.market_movers MODIFY COLUMN symbol LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.historical_data MODIFY COLUMN symbol LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.trending_symbols MODIFY COLUMN symbol LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.tracked_symbols MODIFY COLUMN symbol LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.tracked_symbols MODIFY COLUMN last_source LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.tracked_symbols MODIFY COLUMN last_type LowCardinality(String)`);

    // Bloom filter indexes can speed up symbol IN (...) and high-selectivity filters
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.stock_quotes ADD INDEX IF NOT EXISTS symbol_bf symbol TYPE bloom_filter GRANULARITY 1`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.market_movers ADD INDEX IF NOT EXISTS symbol_bf symbol TYPE bloom_filter GRANULARITY 1`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.historical_data ADD INDEX IF NOT EXISTS symbol_bf symbol TYPE bloom_filter GRANULARITY 1`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.trending_symbols ADD INDEX IF NOT EXISTS symbol_bf symbol TYPE bloom_filter GRANULARITY 1`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.tracked_symbols ADD INDEX IF NOT EXISTS symbol_bf symbol TYPE bloom_filter GRANULARITY 1`);

    console.log(`[${new Date().toISOString()}] ClickHouse database initialized successfully`);
  } catch (error: any) {

    const errorMsg = error?.message || String(error);
    const errorCode = (error as any)?.code;
    const errorType = (error as any)?.type;
    
    if (errorMsg.includes('socket hang up') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('timeout')) {
      console.warn(`[${new Date().toISOString()}] ClickHouse is not available at ${CLICKHOUSE_CONFIG.host}:${CLICKHOUSE_CONFIG.port} (server will continue without database storage)`);
      console.warn(`[${new Date().toISOString()}] To enable ClickHouse: install and start ClickHouse server, or set CLICKHOUSE_HOST environment variable`);
    } else if (errorCode === '81' || errorType === 'UNKNOWN_DATABASE' || errorMsg.includes('does not exist')) {
      console.warn(`[${new Date().toISOString()}] ClickHouse database '${CLICKHOUSE_CONFIG.database}' does not exist. Attempting to create it...`);
      // Try to create the database one more time
      try {
        await clickhouseClient.exec({
          query: `CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}`,
        });
        console.log(`[${new Date().toISOString()}] Database '${CLICKHOUSE_CONFIG.database}' created successfully. Please restart the server to complete initialization.`);
      } catch (createError: any) {
        console.warn(`[${new Date().toISOString()}] Failed to create database: ${createError.message}`);
        console.warn(`[${new Date().toISOString()}] Please create the database '${CLICKHOUSE_CONFIG.database}' manually in ClickHouse, or check your permissions.`);
      }
    } else {
      console.error(error);
      console.warn(`[${new Date().toISOString()}] ClickHouse initialization failed (server will continue without database):`, errorMsg);
    }
    // Don't throw error - allow server to continue without ClickHouse
  }
}

// Store multiple stock quotes in a single ClickHouse insert (much faster than per-row inserts)
// Now stores each stock in its own table
export async function storeStockQuotes(quotes: any[], timestamp: Date = new Date()) {
  try {
    if (!quotes || quotes.length === 0) return;

    // Group quotes by symbol to insert into per-stock tables
    const quotesBySymbol = new Map<string, any[]>();
    for (const quote of quotes) {
      const symbol = quote.symbol;
      if (!symbol) continue;
      
      if (!quotesBySymbol.has(symbol)) {
        quotesBySymbol.set(symbol, []);
      }
      quotesBySymbol.get(symbol)!.push(quote);
    }

    // Insert into each stock's table
    const symbols = Array.from(quotesBySymbol.keys());
    for (const symbol of symbols) {
      const symbolQuotes = quotesBySymbol.get(symbol)!;
      await ensureStockQuotesTable(symbol);
      
      await clickhouseClient.insert({
        table: getStockQuotesTableName(symbol),
        values: symbolQuotes.map((quote: any) => ({
          timestamp: dateToClickHouseDateTime(timestamp),
          price: quote.price || 0,
          change: quote.change || 0,
          change_percent: quote.changePercent || 0,
          volume: quote.volume || 0,
          market_cap: quote.marketCap || 0,
          pe_ratio: quote.peRatio || 0,
          day_high: quote.dayHigh || 0,
          day_low: quote.dayLow || 0,
          previous_close: quote.previousClose || 0,
          currency: quote.currency || 'USD',
        })),
        format: 'JSONEachRow',
      });
    }
  } catch (error) {
    // Silently fail if ClickHouse is not available
    return;
  }
}

// Store stock quote data
export async function storeStockQuote(quote: any) {
  return storeStockQuotes([quote]);
}

// Store market movers data
export async function storeMarketMovers(type: 'gainers' | 'losers', movers: any[]) {
  try {
    const timestamp = new Date(); // single snapshot timestamp for all rows
    const timestampStr = dateToClickHouseDateTime(timestamp);
    const values = movers.map((mover, index) => ({
      timestamp: timestampStr,
      type,
      symbol: mover.symbol,
      name: mover.name,
      price: mover.price,
      change_percent: mover.changePercent,
      rank: index + 1
    }));

    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.market_movers`,
      values,
      format: 'JSONEachRow',
    });

    console.log(`[${new Date().toISOString()}] Stored ${movers.length} ${type} in ClickHouse`);
  } catch (error) {
    // Silently fail if ClickHouse is not available - don't log errors
    // The calling code will handle this gracefully
    return;
  }
}

// Upsert tracked symbols based on market movers (drives historical backfill list)
export async function storeTrackedSymbolsFromMovers(
  type: 'gainers' | 'losers',
  movers: any[],
  source: string = 'market_movers',
) {
  try {
    if (!movers || movers.length === 0) {
      console.log(`[${new Date().toISOString()}] No movers to track for ${type}`);
      return;
    }
    const lastSeen = new Date();
    const lastSeenStr = dateToClickHouseDateTime(lastSeen);
    
    const values = movers.map((mover, index) => ({
      symbol: mover.symbol,
      name: mover.name || mover.shortName || mover.longName || mover.symbol,
      last_source: source,
      last_type: type,
      last_rank: index + 1,
      last_seen: lastSeenStr,
    }));

    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.tracked_symbols`,
      values,
      format: 'JSONEachRow',
    });

    console.log(`[${new Date().toISOString()}] Stored ${values.length} tracked symbols from ${type} (source: ${source})`);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error storing tracked symbols from ${type}:`, error.message);
    // Don't throw - allow script to continue
  }
}

// Get tracked symbols from ClickHouse (de-duplicated)
export async function getTrackedSymbols(days: number = 7, limit: number = 1000): Promise<Array<{ symbol: string; name?: string }>> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT
          symbol,
          anyLast(name) AS name
        FROM ${CLICKHOUSE_CONFIG.database}.tracked_symbols FINAL
        WHERE last_seen >= now() - INTERVAL {days:UInt32} DAY
        GROUP BY symbol
        ORDER BY symbol
        LIMIT {limit:UInt32}
      `,
      query_params: { days, limit },
      format: 'JSONEachRow',
    });
    return result.json();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting tracked symbols:`, error);
    return [];
  }
}

// Query functions for retrieving stored data
// Now reads from per-stock tables
export async function getStockHistory(symbol: string, days: number = 30) {
  try {
    const tableName = getStockQuotesTableName(symbol);
    
    // Check if table exists, if not try the old shared table
    let result;
    try {
      result = await clickhouseClient.query({
        query: `
          SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
          FROM ${tableName}
          WHERE timestamp >= now() - INTERVAL {days:UInt32} DAY
          ORDER BY timestamp DESC
        `,
        query_params: { days },
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      // If per-stock table doesn't exist, try old shared table for backward compatibility
      if (error?.message?.includes('does not exist') || error?.code === '60') {
        result = await clickhouseClient.query({
          query: `
            SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
            FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
            WHERE symbol = {symbol:String}
            AND timestamp >= now() - INTERVAL {days:UInt32} DAY
            ORDER BY timestamp DESC
          `,
          query_params: { symbol, days },
          format: 'JSONEachRow',
        });
      } else {
        throw error;
      }
    }

    const data = await result.json();
    // Add symbol to each record for compatibility
    return data.map((row: any) => ({ ...row, symbol }));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying stock history for ${symbol}:`, error);
    return [];
  }
}

// Get stock history by hours (for intraday data)
export async function getStockHistoryByHours(symbol: string, hours: number = 2, limit: number = 1000) {
  try {
    const tableName = getStockQuotesTableName(symbol);
    
    // Check if table exists, if not try the old shared table
    let result;
    try {
      result = await clickhouseClient.query({
        query: `
          SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
          FROM ${tableName}
          WHERE timestamp >= now() - INTERVAL {hours:UInt32} HOUR
          ORDER BY timestamp ASC
          LIMIT {limit:UInt32}
        `,
        query_params: { hours, limit },
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      // If per-stock table doesn't exist, try old shared table for backward compatibility
      if (error?.message?.includes('does not exist') || error?.code === '60') {
        result = await clickhouseClient.query({
          query: `
            SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
            FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
            WHERE symbol = {symbol:String}
            AND timestamp >= now() - INTERVAL {hours:UInt32} HOUR
            ORDER BY timestamp ASC
            LIMIT {limit:UInt32}
          `,
          query_params: { symbol, hours, limit },
          format: 'JSONEachRow',
        });
      } else {
        throw error;
      }
    }

    const data = await result.json();
    // Add symbol to each record for compatibility
    return data.map((row: any) => ({ ...row, symbol }));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying stock history by hours for ${symbol}:`, error);
    return [];
  }
}

export async function getLatestMarketMovers(type: 'gainers' | 'losers', limit: number = 20) {
  try {
    const result = await clickhouseClient.query({
      query: `
        /* Return the latest snapshot (single timestamp) to avoid mixing rows across multiple fetch cycles */
        WITH (
          SELECT max(timestamp)
          FROM ${CLICKHOUSE_CONFIG.database}.market_movers
          WHERE type = {type:String}
            AND timestamp >= toDateTime(today())
        ) AS latest_ts
        SELECT *
        FROM ${CLICKHOUSE_CONFIG.database}.market_movers
        WHERE type = {type:String}
          AND timestamp = latest_ts
        ORDER BY rank ASC
        LIMIT {limit:UInt32}
      `,
      query_params: { type, limit },
      format: 'JSONEachRow',
    });

    return result.json();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying market movers (${type}):`, error);
    return [];
  }
}

// Get market movers history (multiple snapshots)
export async function getMarketMoversHistory(type: 'gainers' | 'losers', limit: number = 100) {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT *
        FROM ${CLICKHOUSE_CONFIG.database}.market_movers
        WHERE type = {type:String}
        ORDER BY timestamp DESC, rank ASC
        LIMIT {limit:UInt32}
      `,
      query_params: { type, limit },
      format: 'JSONEachRow',
    });
    return result.json();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying market movers history (${type}):`, error);
    return [];
  }
}

// Store historical OHLCV data
// Now stores each stock in its own table
export async function storeHistoricalData(symbol: string, data: any[]) {
  try {
    if (!data || data.length === 0) return;

    await ensureHistoricalDataTable(symbol);

    const values = data.map((item: any) => ({
      date: new Date(item.date),
      open: item.open || 0,
      high: item.high || 0,
      low: item.low || 0,
      close: item.close || 0,
      volume: item.volume || 0,
      adj_close: item.adjClose || item.close || 0,
    }));

    await clickhouseClient.insert({
      table: getHistoricalDataTableName(symbol),
      values,
      format: 'JSONEachRow',
    });

    console.log(`[${new Date().toISOString()}] Stored ${data.length} historical records for ${symbol}`);
  } catch (error) {
    // Silently fail if ClickHouse is not available
    return;
  }
}

// Get historical data for a symbol
// Now reads from per-stock tables
export async function getHistoricalData(symbol: string, days: number = 30) {
  try {
    const tableName = getHistoricalDataTableName(symbol);
    
    // Check if table exists, if not try the old shared table
    let result;
    try {
      result = await clickhouseClient.query({
        query: `
          SELECT date, open, high, low, close, volume, adj_close
          FROM ${tableName}
          WHERE date >= today() - INTERVAL {days:UInt32} DAY
          ORDER BY date ASC
        `,
        query_params: { days },
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      // If per-stock table doesn't exist, try old shared table for backward compatibility
      if (error?.message?.includes('does not exist') || error?.code === '60') {
        result = await clickhouseClient.query({
          query: `
            SELECT date, open, high, low, close, volume, adj_close
            FROM ${CLICKHOUSE_CONFIG.database}.historical_data
            WHERE symbol = {symbol:String}
            AND date >= today() - INTERVAL {days:UInt32} DAY
            ORDER BY date ASC
          `,
          query_params: { symbol, days },
          format: 'JSONEachRow',
        });
      } else {
        throw error;
      }
    }

    return result.json();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying historical data for ${symbol}:`, error);
    return [];
  }
}

// Store trending symbols
export async function storeTrendingSymbols(symbols: any[]) {
  try {
    if (!symbols || symbols.length === 0) return;

    const timestamp = new Date(); // single snapshot timestamp
    const timestampStr = dateToClickHouseDateTime(timestamp);
    const values = symbols.map((item: any, index: number) => ({
      timestamp: timestampStr,
      symbol: item.symbol,
      name: item.shortName || item.longName || item.symbol,
      rank: index + 1,
    }));

    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.trending_symbols`,
      values,
      format: 'JSONEachRow',
    });

    console.log(`[${new Date().toISOString()}] Stored ${symbols.length} trending symbols`);
  } catch (error) {
    // Silently fail if ClickHouse is not available
    return;
  }
}

// Get latest trending symbols
export async function getLatestTrendingSymbols(limit: number = 20) {
  try {
    const result = await clickhouseClient.query({
      query: `
        /* Return the latest snapshot (single timestamp) */
        WITH (
          SELECT max(timestamp)
          FROM ${CLICKHOUSE_CONFIG.database}.trending_symbols
          WHERE timestamp >= now() - INTERVAL 1 HOUR
        ) AS latest_ts
        SELECT symbol, name, rank
        FROM ${CLICKHOUSE_CONFIG.database}.trending_symbols
        WHERE timestamp = latest_ts
        ORDER BY rank ASC
        LIMIT {limit:UInt32}
      `,
      query_params: { limit },
      format: 'JSONEachRow',
    });

    return result.json();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying trending symbols:`, error);
    return [];
  }
}

// Get latest stock quote from database
// Now reads from per-stock tables
export async function getLatestStockQuote(symbol: string) {
  try {
    const tableName = getStockQuotesTableName(symbol);
    
    // Check if table exists, if not try the old shared table
    let result;
    try {
      result = await clickhouseClient.query({
        query: `
          SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
          FROM ${tableName}
          ORDER BY timestamp DESC
          LIMIT 1
        `,
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      // If per-stock table doesn't exist, try old shared table for backward compatibility
      if (error?.message?.includes('does not exist') || error?.code === '60') {
        result = await clickhouseClient.query({
          query: `
            SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
            FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
            WHERE symbol = {symbol:String}
            ORDER BY timestamp DESC
            LIMIT 1
          `,
          query_params: { symbol },
          format: 'JSONEachRow',
        });
      } else {
        throw error;
      }
    }

    const data: any = await result.json();
    if (data.length > 0) {
      return { ...data[0], symbol }; // Add symbol for compatibility
    }
    return null;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying stock quote for ${symbol}:`, error);
    return null;
  }
}

// Check if data is fresh (within the given minutes)
export async function isDataFresh(table: string, minutes: number = 5): Promise<boolean> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT count() as count
        FROM ${CLICKHOUSE_CONFIG.database}.${table}
        WHERE timestamp >= now() - INTERVAL {minutes:UInt32} MINUTE
      `,
      query_params: { minutes },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.length > 0 && data[0].count > 0;
  } catch (error) {
    return false;
  }
}

// Get the date range of existing historical data for a symbol
// Now reads from per-stock tables
export async function getHistoricalDataRange(symbol: string): Promise<{ minDate: Date | null; maxDate: Date | null; count: number }> {
  try {
    const tableName = getHistoricalDataTableName(symbol);
    
    // Check if table exists, if not try the old shared table
    let result;
    try {
      result = await clickhouseClient.query({
        query: `
          SELECT 
            min(date) as min_date,
            max(date) as max_date,
            count() as count
          FROM ${tableName}
        `,
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      // If per-stock table doesn't exist, try old shared table for backward compatibility
      if (error?.message?.includes('does not exist') || error?.code === '60') {
        result = await clickhouseClient.query({
          query: `
            SELECT 
              min(date) as min_date,
              max(date) as max_date,
              count() as count
            FROM ${CLICKHOUSE_CONFIG.database}.historical_data
            WHERE symbol = {symbol:String}
          `,
          query_params: { symbol },
          format: 'JSONEachRow',
        });
      } else {
        throw error;
      }
    }

    const data: any = await result.json();
    if (data.length > 0 && data[0].count > 0) {
      return {
        minDate: new Date(data[0].min_date),
        maxDate: new Date(data[0].max_date),
        count: Number(data[0].count)
      };
    }
    return { minDate: null, maxDate: null, count: 0 };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error checking historical data range for ${symbol}:`, error);
    return { minDate: null, maxDate: null, count: 0 };
  }
}

// Get all unique symbols from market movers
export async function getAllTrackedSymbols(): Promise<string[]> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT symbol
        FROM ${CLICKHOUSE_CONFIG.database}.tracked_symbols FINAL
        WHERE last_seen >= now() - INTERVAL 7 DAY
        GROUP BY symbol
        ORDER BY symbol
      `,
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.map((row: any) => row.symbol);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting tracked symbols:`, error);
    return [];
  }
}

// Get symbols that need historical data backfill
// Updated to check per-stock tables
export async function getSymbolsNeedingBackfill(targetDays: number = 365): Promise<string[]> {
  try {
    // Get tracked symbols
    const trackedResult = await clickhouseClient.query({
      query: `
        SELECT symbol
        FROM ${CLICKHOUSE_CONFIG.database}.tracked_symbols
        WHERE last_seen >= now() - INTERVAL 7 DAY
        GROUP BY symbol
        ORDER BY symbol
      `,
      format: 'JSONEachRow',
    });
    
    const trackedData: any = await trackedResult.json();
    const trackedSymbols = trackedData.map((row: any) => row.symbol);
    
    if (trackedSymbols.length === 0) {
      return [];
    }

    // Check each symbol's per-stock table or fall back to shared table
    const symbolsNeedingBackfill: string[] = [];
    const minRecords = Math.floor(targetDays * 0.7);
    
    for (const symbol of trackedSymbols) {
      try {
        const tableName = getHistoricalDataTableName(symbol);
        let result;
        
        try {
          // Try per-stock table first
          result = await clickhouseClient.query({
            query: `
              SELECT 
                min(date) as min_date,
                max(date) as max_date,
                count() as record_count
              FROM ${tableName}
            `,
            format: 'JSONEachRow',
          });
        } catch (error: any) {
          // If per-stock table doesn't exist, try old shared table
          if (error?.message?.includes('does not exist') || error?.code === '60') {
            result = await clickhouseClient.query({
              query: `
                SELECT 
                  min(date) as min_date,
                  max(date) as max_date,
                  count() as record_count
                FROM ${CLICKHOUSE_CONFIG.database}.historical_data
                WHERE symbol = {symbol:String}
              `,
              query_params: { symbol },
              format: 'JSONEachRow',
            });
          } else {
            throw error;
          }
        }
        
        const data: any = await result.json();
        const recordCount = data.length > 0 ? Number(data[0].record_count || 0) : 0;
        const minDate = data.length > 0 && data[0].min_date ? new Date(data[0].min_date) : null;
        
        const needsBackfill = 
          recordCount === 0 ||
          recordCount < minRecords ||
          (minDate && minDate > new Date(Date.now() - targetDays * 24 * 60 * 60 * 1000));
        
        if (needsBackfill) {
          symbolsNeedingBackfill.push(symbol);
        }
      } catch (error) {
        // If we can't check, assume it needs backfill
        symbolsNeedingBackfill.push(symbol);
      }
    }
    
    return symbolsNeedingBackfill;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting symbols needing backfill:`, error);
    return [];
  }
}

// Script execution logging functions
export interface ScriptExecutionLog {
  script_name: string;
  status: 'success' | 'failed' | 'running';
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;
  rows_affected?: number;
  error_message?: string;
  metadata?: Record<string, any>;
}

// Start logging a script execution
export async function logScriptStart(scriptName: string, metadata?: Record<string, any>): Promise<string | null> {
  try {
    const startedAt = new Date();
    const logEntry = {
      script_name: scriptName,
      status: 'running',
      started_at: dateToClickHouseDateTime(startedAt),
      metadata: metadata ? JSON.stringify(metadata) : null,
    };

    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.script_execution_log`,
      values: [logEntry],
      format: 'JSONEachRow',
    });

    // Return a unique identifier (we'll use started_at as identifier)
    return startedAt.toISOString();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error logging script start for ${scriptName}:`, error);
    return null;
  }
}

// Update script execution log with completion status
// Using ReplacingMergeTree, inserting with same script_name and started_at will replace the record
export async function logScriptEnd(
  scriptName: string,
  startedAt: Date,
  status: 'success' | 'failed',
  rowsAffected?: number,
  errorMessage?: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Sanitize metadata to ensure all values are JSON-serializable
    let metadataString: string | null = null;
    if (metadata) {
      try {
        // Convert any Date objects or other non-serializable values to strings
        const sanitizedMetadata: Record<string, any> = {};
        for (const [key, value] of Object.entries(metadata)) {
          if (value instanceof Date) {
            sanitizedMetadata[key] = value.toISOString();
          } else if (value === undefined) {
            sanitizedMetadata[key] = null;
          } else {
            sanitizedMetadata[key] = value;
          }
        }
        metadataString = JSON.stringify(sanitizedMetadata);
      } catch (err) {
        // If metadata can't be stringified, use a simple string representation
        metadataString = JSON.stringify({ error: 'Failed to serialize metadata' });
      }
    }

    // Insert completion record - ReplacingMergeTree will replace the 'running' record
    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.script_execution_log`,
      values: [{
        script_name: scriptName,
        status,
        started_at: dateToClickHouseDateTime(startedAt),
        completed_at: dateToClickHouseDateTime(completedAt),
        duration_ms: durationMs,
        rows_affected: rowsAffected || null,
        error_message: errorMessage || null,
        metadata: metadataString,
      }],
      format: 'JSONEachRow',
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error logging script end for ${scriptName}:`, error);
  }
}

// Get script execution history
export async function getScriptExecutionHistory(
  scriptName?: string,
  limit: number = 50
): Promise<ScriptExecutionLog[]> {
  try {
    let query = `
      SELECT 
        script_name,
        status,
        started_at,
        completed_at,
        duration_ms,
        rows_affected,
        error_message,
        metadata
      FROM ${CLICKHOUSE_CONFIG.database}.script_execution_log
    `;

    const queryParams: any = { limit };

    if (scriptName) {
      query += ` WHERE script_name = {script_name:String}`;
      queryParams.script_name = scriptName;
    }

    query += ` ORDER BY started_at DESC LIMIT {limit:UInt32}`;

    const result = await clickhouseClient.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.map((row: any) => ({
      script_name: row.script_name,
      status: row.status,
      started_at: new Date(row.started_at),
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      duration_ms: row.duration_ms ? Number(row.duration_ms) : undefined,
      rows_affected: row.rows_affected ? Number(row.rows_affected) : undefined,
      error_message: row.error_message || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting script execution history:`, error);
    return [];
  }
}

// Get latest script execution status
export async function getLatestScriptExecution(scriptName: string): Promise<ScriptExecutionLog | null> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT 
          script_name,
          status,
          started_at,
          completed_at,
          duration_ms,
          rows_affected,
          error_message,
          metadata
        FROM ${CLICKHOUSE_CONFIG.database}.script_execution_log
        WHERE script_name = {script_name:String}
        ORDER BY started_at DESC
        LIMIT 1
      `,
      query_params: { script_name: scriptName },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    if (data.length === 0) return null;

    const row = data[0];
    return {
      script_name: row.script_name,
      status: row.status,
      started_at: new Date(row.started_at),
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      duration_ms: row.duration_ms ? Number(row.duration_ms) : undefined,
      rows_affected: row.rows_affected ? Number(row.rows_affected) : undefined,
      error_message: row.error_message || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting latest script execution for ${scriptName}:`, error);
    return null;
  }
}

// Technical Indicators functions

export interface TechnicalIndicatorData {
  date: Date;
  symbol: string;
  rsi: number;
  macdValue: number;
  macdSignal: number;
  macdHistogram: number;
  volatility: number;
  volatilityPercent: number;
  dataPoints: number;
}

// Store technical indicators
export async function storeTechnicalIndicators(indicators: TechnicalIndicatorData[]): Promise<void> {
  try {
    if (!indicators || indicators.length === 0) return;

    const values = indicators.map((indicator) => ({
      date: indicator.date,
      symbol: indicator.symbol,
      rsi: indicator.rsi,
      macd_value: indicator.macdValue,
      macd_signal: indicator.macdSignal,
      macd_histogram: indicator.macdHistogram,
      volatility: indicator.volatility,
      volatility_percent: indicator.volatilityPercent,
      data_points: indicator.dataPoints,
    }));

    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.technical_indicators`,
      values,
      format: 'JSONEachRow',
    });

    console.log(`[${new Date().toISOString()}] Stored ${indicators.length} technical indicator records`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error storing technical indicators:`, error);
    // Don't throw - allow script to continue
  }
}

// Get latest technical indicators for a symbol
export async function getLatestTechnicalIndicators(symbol: string): Promise<TechnicalIndicatorData | null> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT 
          date,
          symbol,
          rsi,
          macd_value,
          macd_signal,
          macd_histogram,
          volatility,
          volatility_percent,
          data_points
        FROM ${CLICKHOUSE_CONFIG.database}.technical_indicators
        WHERE symbol = {symbol:String}
        ORDER BY date DESC
        LIMIT 1
      `,
      query_params: { symbol },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    if (data.length === 0) return null;

    const row = data[0];
    return {
      date: new Date(row.date),
      symbol: row.symbol,
      rsi: Number(row.rsi),
      macdValue: Number(row.macd_value),
      macdSignal: Number(row.macd_signal),
      macdHistogram: Number(row.macd_histogram),
      volatility: Number(row.volatility),
      volatilityPercent: Number(row.volatility_percent),
      dataPoints: Number(row.data_points),
    };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting latest technical indicators for ${symbol}:`, error);
    return null;
  }
}

// Get technical indicators history for a symbol
export async function getTechnicalIndicatorsHistory(
  symbol: string,
  days: number = 30
): Promise<TechnicalIndicatorData[]> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT 
          date,
          symbol,
          rsi,
          macd_value,
          macd_signal,
          macd_histogram,
          volatility,
          volatility_percent,
          data_points
        FROM ${CLICKHOUSE_CONFIG.database}.technical_indicators
        WHERE symbol = {symbol:String}
        AND date >= today() - INTERVAL {days:UInt32} DAY
        ORDER BY date DESC
      `,
      query_params: { symbol, days },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.map((row: any) => ({
      date: new Date(row.date),
      symbol: row.symbol,
      rsi: Number(row.rsi),
      macdValue: Number(row.macd_value),
      macdSignal: Number(row.macd_signal),
      macdHistogram: Number(row.macd_histogram),
      volatility: Number(row.volatility),
      volatilityPercent: Number(row.volatility_percent),
      dataPoints: Number(row.data_points),
    }));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting technical indicators history for ${symbol}:`, error);
    return [];
  }
}

// Check if indicators are fresh for a symbol (within last day)
export async function hasFreshIndicators(symbol: string, maxAgeHours: number = 24): Promise<boolean> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT count() as count
        FROM ${CLICKHOUSE_CONFIG.database}.technical_indicators
        WHERE symbol = {symbol:String}
        AND date = today()
        AND calculated_at >= now() - INTERVAL {hours:UInt32} HOUR
      `,
      query_params: { symbol, hours: maxAgeHours },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.length > 0 && data[0].count > 0;
  } catch (error) {
    return false;
  }
}

// AI Strategy and Trading Functions

export interface AIStrategyResult {
  timestamp: Date;
  symbol: string;
  strategy: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  price: number;
  technicalIndicators?: {
    rsi?: number;
    macd?: number;
    bollingerBands?: { upper: number; middle: number; lower: number };
    movingAverages?: { sma20: number; sma50: number; ema12: number; ema26: number };
  };
}

export interface AISignal {
  signalId: string;
  timestamp: Date;
  symbol: string;
  strategy: string;
  action: 'BUY' | 'SELL';
  confidence: number;
  reason: string;
  price: number;
  status: 'pending' | 'executed' | 'cancelled';
  executedAt?: Date;
  tradeId?: string;
}

export interface Trade {
  tradeId: string;
  signalId: string;
  timestamp: Date;
  symbol: string;
  action: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number;
  quantity: number;
  investmentAmount: number;
  confidence: number;
  exitPrice?: number;
  exitTimestamp?: Date;
  profitLoss?: number;
  profitLossPercent?: number;
  status: 'open' | 'closed' | 'cancelled';
  reason: string;
}

// Store AI strategy result
export async function storeAIStrategyResult(result: AIStrategyResult): Promise<void> {
  try {
    const indicators = result.technicalIndicators || {};
    const bb = indicators.bollingerBands;
    const ma = indicators.movingAverages;

    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.ai_strategy_results`,
      values: [{
        timestamp: dateToClickHouseDateTime(result.timestamp),
        symbol: result.symbol,
        strategy: result.strategy,
        action: result.action,
        confidence: result.confidence,
        reason: result.reason,
        price: result.price,
        rsi: indicators.rsi || null,
        macd: indicators.macd || null,
        bb_upper: bb?.upper || null,
        bb_middle: bb?.middle || null,
        bb_lower: bb?.lower || null,
        sma20: ma?.sma20 || null,
        sma50: ma?.sma50 || null,
        ema12: ma?.ema12 || null,
        ema26: ma?.ema26 || null,
      }],
      format: 'JSONEachRow',
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error storing AI strategy result:`, error);
  }
}

// Store AI signal (high confidence > 75%)
export async function storeAISignal(signal: AISignal): Promise<void> {
  try {
    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.ai_signals`,
      values: [{
        signal_id: signal.signalId,
        timestamp: dateToClickHouseDateTime(signal.timestamp),
        symbol: signal.symbol,
        strategy: signal.strategy,
        action: signal.action,
        confidence: signal.confidence,
        reason: signal.reason,
        price: signal.price,
        status: signal.status,
        executed_at: signal.executedAt ? dateToClickHouseDateTime(signal.executedAt) : null,
        trade_id: signal.tradeId || null,
        updated_at: dateToClickHouseDateTime(signal.executedAt || signal.timestamp), // Use executed_at if available, otherwise timestamp
      }],
      format: 'JSONEachRow',
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error storing AI signal:`, error);
  }
}

// Store trade history
export async function storeTrade(trade: Trade): Promise<void> {
  try {
    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.trade_history`,
      values: [{
        trade_id: trade.tradeId,
        signal_id: trade.signalId,
        timestamp: dateToClickHouseDateTime(trade.timestamp),
        symbol: trade.symbol,
        action: trade.action,
        strategy: trade.strategy,
        entry_price: trade.entryPrice,
        quantity: trade.quantity,
        investment_amount: trade.investmentAmount,
        confidence: trade.confidence,
        exit_price: trade.exitPrice || null,
        exit_timestamp: trade.exitTimestamp ? dateToClickHouseDateTime(trade.exitTimestamp) : null,
        profit_loss: trade.profitLoss || null,
        profit_loss_percent: trade.profitLossPercent || null,
        status: trade.status,
        reason: trade.reason,
        updated_at: dateToClickHouseDateTime(trade.exitTimestamp || trade.timestamp), // Use exit_timestamp if available, otherwise timestamp
      }],
      format: 'JSONEachRow',
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error storing trade:`, error);
  }
}

// Get pending AI signals
export async function getPendingAISignals(limit: number = 100): Promise<AISignal[]> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT 
          signal_id,
          timestamp,
          symbol,
          strategy,
          action,
          confidence,
          reason,
          price,
          status,
          executed_at,
          trade_id
        FROM ${CLICKHOUSE_CONFIG.database}.ai_signals
        WHERE status = 'pending'
        ORDER BY confidence DESC, timestamp DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { limit },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.map((row: any) => ({
      signalId: row.signal_id,
      timestamp: new Date(row.timestamp),
      symbol: row.symbol,
      strategy: row.strategy,
      action: row.action,
      confidence: Number(row.confidence),
      reason: row.reason,
      price: Number(row.price),
      status: row.status,
      executedAt: row.executed_at ? new Date(row.executed_at) : undefined,
      tradeId: row.trade_id || undefined,
    }));
  } catch (error: any) {
    // If table doesn't exist, return empty array (tables will be created on server restart)
    if (error?.code === '60' || error?.message?.includes('does not exist') || error?.type === 'UNKNOWN_TABLE') {
      console.warn(`[${new Date().toISOString()}] AI signals table does not exist yet. Tables will be created on server restart.`);
      return [];
    }
    console.error(`[${new Date().toISOString()}] Error getting pending AI signals:`, error);
    return [];
  }
}

// Get open trades
export async function getOpenTrades(symbol?: string): Promise<Trade[]> {
  try {
    let query = `
      SELECT 
        trade_id,
        signal_id,
        timestamp,
        symbol,
        action,
        strategy,
        entry_price,
        quantity,
        investment_amount,
        confidence,
        exit_price,
        exit_timestamp,
        profit_loss,
        profit_loss_percent,
        status,
        reason
      FROM ${CLICKHOUSE_CONFIG.database}.trade_history
      WHERE status = 'open'
    `;
    
    const queryParams: any = {};
    if (symbol) {
      query += ` AND symbol = {symbol:String}`;
      queryParams.symbol = symbol;
    }
    
    query += ` ORDER BY timestamp DESC`;

    const result = await clickhouseClient.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.map((row: any) => ({
      tradeId: row.trade_id,
      signalId: row.signal_id,
      timestamp: new Date(row.timestamp),
      symbol: row.symbol,
      action: row.action,
      strategy: row.strategy,
      entryPrice: Number(row.entry_price),
      quantity: Number(row.quantity),
      investmentAmount: Number(row.investment_amount),
      confidence: Number(row.confidence),
      exitPrice: row.exit_price ? Number(row.exit_price) : undefined,
      exitTimestamp: row.exit_timestamp ? new Date(row.exit_timestamp) : undefined,
      profitLoss: row.profit_loss ? Number(row.profit_loss) : undefined,
      profitLossPercent: row.profit_loss_percent ? Number(row.profit_loss_percent) : undefined,
      status: row.status,
      reason: row.reason,
    }));
  } catch (error: any) {
    // If table doesn't exist, return empty array (tables will be created on server restart)
    if (error?.code === '60' || error?.message?.includes('does not exist') || error?.type === 'UNKNOWN_TABLE') {
      console.warn(`[${new Date().toISOString()}] Trade history table does not exist yet. Tables will be created on server restart.`);
      return [];
    }
    console.error(`[${new Date().toISOString()}] Error getting open trades:`, error);
    return [];
  }
}