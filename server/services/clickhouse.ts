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
          symbol String,
          price Float64,
          change Float64,
          change_percent Float64,
          volume UInt64,
          market_cap UInt64,
          pe_ratio Float64,
          day_high Float64,
          day_low Float64,
          previous_close Float64,
          currency String
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
          type String, -- 'gainers' or 'losers'
          symbol String,
          name String,
          price Float64,
          change_percent Float64,
          rank UInt32 -- position in the list (1-20)
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
          symbol String,
          open Float64,
          high Float64,
          low Float64,
          close Float64,
          volume UInt64,
          adj_close Float64,
          fetched_at DateTime DEFAULT now()
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
          symbol String,
          name String,
          rank UInt32
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMMDD(timestamp)
        ORDER BY (timestamp, rank)
        TTL timestamp + INTERVAL 7 DAY
      `,
    });

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

// Store stock quote data
export async function storeStockQuote(quote: any) {
  try {
    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.stock_quotes`,
      values: [{
        timestamp: new Date(),
        symbol: quote.symbol,
        price: quote.price || 0,
        change: quote.change || 0,
        change_percent: quote.changePercent || 0,
        volume: quote.volume || 0,
        market_cap: quote.marketCap || 0,
        pe_ratio: quote.peRatio || 0,
        day_high: 0, // Not provided in current data
        day_low: 0,  // Not provided in current data
        previous_close: 0, // Not provided in current data
        currency: 'USD'
      }],
      format: 'JSONEachRow',
    });
  } catch (error) {
    // Silently fail if ClickHouse is not available - don't log errors
    // The calling code will handle this gracefully
    return;
  }
}

// Store market movers data
export async function storeMarketMovers(type: 'gainers' | 'losers', movers: any[]) {
  try {
    const values = movers.map((mover, index) => ({
      timestamp: new Date(),
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

// Query functions for retrieving stored data
export async function getStockHistory(symbol: string, days: number = 30) {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT *
        FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
        WHERE symbol = {symbol:String}
        AND timestamp >= now() - INTERVAL {days:UInt32} DAY
        ORDER BY timestamp DESC
      `,
      query_params: { symbol, days },
      format: 'JSONEachRow',
    });

    return result.json();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying stock history for ${symbol}:`, error);
    return [];
  }
}

export async function getLatestMarketMovers(type: 'gainers' | 'losers', limit: number = 20) {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT *
        FROM ${CLICKHOUSE_CONFIG.database}.market_movers
        WHERE type = {type:String}
        AND timestamp >= today()
        ORDER BY timestamp DESC, rank ASC
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

// Store historical OHLCV data
export async function storeHistoricalData(symbol: string, data: any[]) {
  try {
    if (!data || data.length === 0) return;

    const values = data.map((item: any) => ({
      date: new Date(item.date),
      symbol,
      open: item.open || 0,
      high: item.high || 0,
      low: item.low || 0,
      close: item.close || 0,
      volume: item.volume || 0,
      adj_close: item.adjClose || item.close || 0,
    }));

    await clickhouseClient.insert({
      table: `${CLICKHOUSE_CONFIG.database}.historical_data`,
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
export async function getHistoricalData(symbol: string, days: number = 30) {
  try {
    const result = await clickhouseClient.query({
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

    const values = symbols.map((item: any, index: number) => ({
      timestamp: new Date(),
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
        SELECT symbol, name, rank
        FROM ${CLICKHOUSE_CONFIG.database}.trending_symbols
        WHERE timestamp >= now() - INTERVAL 1 HOUR
        ORDER BY timestamp DESC, rank ASC
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
export async function getLatestStockQuote(symbol: string) {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT *
        FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
        WHERE symbol = {symbol:String}
        ORDER BY timestamp DESC
        LIMIT 1
      `,
      query_params: { symbol },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.length > 0 ? data[0] : null;
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