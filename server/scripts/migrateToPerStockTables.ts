/**
 * Migration Script: Transfer Data to Per-Stock Tables
 * 
 * This script migrates existing stock data from shared tables to per-stock tables.
 * Each stock will have its own dedicated tables for quotes and historical data.
 * 
 * Usage:
 *   npm run migrate:per-stock
 *   npx tsx server/scripts/migrateToPerStockTables.ts
 * 
 * Environment Variables:
 *   CLICKHOUSE_HOST - Database host (default: localhost)
 *   CLICKHOUSE_PORT - Database port (default: 8123)
 *   CLICKHOUSE_USERNAME - Database username
 *   CLICKHOUSE_PASSWORD - Database password
 *   CLICKHOUSE_DATABASE - Database name (default: market_data)
 */

import 'dotenv/config';
import { createClient } from '@clickhouse/client';
import { CLICKHOUSE_CONFIG } from '../config/database';
import { logScriptStart, logScriptEnd } from '../services/clickhouse';

// Determine protocol based on port
const getProtocol = (port: string) => {
  return (port === '8443' || port === '9440') ? 'https' : 'http';
};

// Create client
const client = createClient({
  url: `${getProtocol(CLICKHOUSE_CONFIG.port)}://${CLICKHOUSE_CONFIG.host}:${CLICKHOUSE_CONFIG.port}`,
  username: CLICKHOUSE_CONFIG.username,
  password: CLICKHOUSE_CONFIG.password,
  database: CLICKHOUSE_CONFIG.database,
  request_timeout: 300000, // 5 minutes for large migrations
});

// Sanitize symbol name for use in table name
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

// Logging helper
function log(message: string) {
  console.log(`[${new Date().toISOString()}] [Migrate] ${message}`);
}

function error(message: string) {
  console.error(`[${new Date().toISOString()}] [Migrate] ERROR: ${message}`);
}

// Create per-stock quotes table with indexes
async function createStockQuotesTable(symbol: string): Promise<void> {
  const tableName = getStockQuotesTableName(symbol);
  
  try {
    await client.exec({
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
  } catch (err: any) {
    if (!err?.message?.includes('already exists') && err?.code !== '57') {
      throw err;
    }
  }
}

// Create per-stock historical data table with indexes
async function createHistoricalDataTable(symbol: string): Promise<void> {
  const tableName = getHistoricalDataTableName(symbol);
  
  try {
    await client.exec({
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
  } catch (err: any) {
    if (!err?.message?.includes('already exists') && err?.code !== '57') {
      throw err;
    }
  }
}

// Get all unique symbols from stock_quotes table
async function getSymbolsFromStockQuotes(): Promise<string[]> {
  try {
    const result = await client.query({
      query: `
        SELECT DISTINCT symbol
        FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
        ORDER BY symbol
      `,
      format: 'JSONEachRow',
    });
    
    const data: any = await result.json();
    return data.map((row: any) => row.symbol).filter((s: string) => s);
  } catch (err: any) {
    if (err?.message?.includes('does not exist') || err?.code === '60') {
      log('stock_quotes table does not exist, skipping...');
      return [];
    }
    throw err;
  }
}

// Get all unique symbols from historical_data table
async function getSymbolsFromHistoricalData(): Promise<string[]> {
  try {
    const result = await client.query({
      query: `
        SELECT DISTINCT symbol
        FROM ${CLICKHOUSE_CONFIG.database}.historical_data
        ORDER BY symbol
      `,
      format: 'JSONEachRow',
    });
    
    const data: any = await result.json();
    return data.map((row: any) => row.symbol).filter((s: string) => s);
  } catch (err: any) {
    if (err?.message?.includes('does not exist') || err?.code === '60') {
      log('historical_data table does not exist, skipping...');
      return [];
    }
    throw err;
  }
}

// Migrate stock quotes for a single symbol
async function migrateStockQuotesForSymbol(symbol: string, batchSize: number = 10000): Promise<number> {
  try {
    log(`Migrating stock quotes for ${symbol}...`);
    
    // Create per-stock table
    await createStockQuotesTable(symbol);
    
    // Check if data already exists in per-stock table
    const existingCountResult = await client.query({
      query: `SELECT count() as count FROM ${getStockQuotesTableName(symbol)}`,
      format: 'JSONEachRow',
    });
    const existingData: any = await existingCountResult.json();
    const existingCount = existingData[0]?.count || 0;
    
    if (existingCount > 0) {
      log(`  ${symbol}: ${existingCount.toLocaleString()} rows already exist in per-stock table, skipping...`);
      return 0;
    }
    
    // Get count from source table
    const sourceCountResult = await client.query({
      query: `
        SELECT count() as count
        FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
        WHERE symbol = {symbol:String}
      `,
      query_params: { symbol },
      format: 'JSONEachRow',
    });
    const sourceData: any = await sourceCountResult.json();
    const sourceCount = sourceData[0]?.count || 0;
    
    if (sourceCount === 0) {
      log(`  ${symbol}: No data to migrate`);
      return 0;
    }
    
    log(`  ${symbol}: Migrating ${sourceCount.toLocaleString()} rows...`);
    
    // Migrate in batches
    let offset = 0;
    let totalMigrated = 0;
    const targetTable = getStockQuotesTableName(symbol);
    
    while (true) {
      const result = await client.query({
        query: `
          SELECT 
            timestamp,
            price,
            change,
            change_percent,
            volume,
            market_cap,
            pe_ratio,
            day_high,
            day_low,
            previous_close,
            currency
          FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
          WHERE symbol = {symbol:String}
          ORDER BY timestamp ASC
          LIMIT {limit:UInt32} OFFSET {offset:UInt64}
        `,
        query_params: { symbol, limit: batchSize, offset },
        format: 'JSONEachRow',
      });
      
      const rows: any[] = await result.json();
      
      if (rows.length === 0) {
        break;
      }
      
      // Insert into per-stock table
      await client.insert({
        table: targetTable,
        values: rows,
        format: 'JSONEachRow',
      });
      
      totalMigrated += rows.length;
      log(`  ${symbol}: Migrated ${totalMigrated.toLocaleString()}/${sourceCount.toLocaleString()} rows`);
      
      if (rows.length < batchSize) {
        break;
      }
      
      offset += batchSize;
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    log(`  ${symbol}: ✓ Completed migration of ${totalMigrated.toLocaleString()} rows`);
    return totalMigrated;
  } catch (err: any) {
    error(`Failed to migrate stock quotes for ${symbol}: ${err.message}`);
    throw err;
  }
}

// Migrate historical data for a single symbol
async function migrateHistoricalDataForSymbol(symbol: string, batchSize: number = 10000): Promise<number> {
  try {
    log(`Migrating historical data for ${symbol}...`);
    
    // Create per-stock table
    await createHistoricalDataTable(symbol);
    
    // Check if data already exists in per-stock table
    const existingCountResult = await client.query({
      query: `SELECT count() as count FROM ${getHistoricalDataTableName(symbol)}`,
      format: 'JSONEachRow',
    });
    const existingData: any = await existingCountResult.json();
    const existingCount = existingData[0]?.count || 0;
    
    if (existingCount > 0) {
      log(`  ${symbol}: ${existingCount.toLocaleString()} rows already exist in per-stock table, skipping...`);
      return 0;
    }
    
    // Get count from source table
    const sourceCountResult = await client.query({
      query: `
        SELECT count() as count
        FROM ${CLICKHOUSE_CONFIG.database}.historical_data
        WHERE symbol = {symbol:String}
      `,
      query_params: { symbol },
      format: 'JSONEachRow',
    });
    const sourceData: any = await sourceCountResult.json();
    const sourceCount = sourceData[0]?.count || 0;
    
    if (sourceCount === 0) {
      log(`  ${symbol}: No data to migrate`);
      return 0;
    }
    
    log(`  ${symbol}: Migrating ${sourceCount.toLocaleString()} rows...`);
    
    // Migrate in batches
    let offset = 0;
    let totalMigrated = 0;
    const targetTable = getHistoricalDataTableName(symbol);
    
    while (true) {
      const result = await client.query({
        query: `
          SELECT 
            date,
            open,
            high,
            low,
            close,
            volume,
            adj_close,
            fetched_at
          FROM ${CLICKHOUSE_CONFIG.database}.historical_data
          WHERE symbol = {symbol:String}
          ORDER BY date ASC
          LIMIT {limit:UInt32} OFFSET {offset:UInt64}
        `,
        query_params: { symbol, limit: batchSize, offset },
        format: 'JSONEachRow',
      });
      
      const rows: any[] = await result.json();
      
      if (rows.length === 0) {
        break;
      }
      
      // Insert into per-stock table
      await client.insert({
        table: targetTable,
        values: rows,
        format: 'JSONEachRow',
      });
      
      totalMigrated += rows.length;
      log(`  ${symbol}: Migrated ${totalMigrated.toLocaleString()}/${sourceCount.toLocaleString()} rows`);
      
      if (rows.length < batchSize) {
        break;
      }
      
      offset += batchSize;
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    log(`  ${symbol}: ✓ Completed migration of ${totalMigrated.toLocaleString()} rows`);
    return totalMigrated;
  } catch (err: any) {
    error(`Failed to migrate historical data for ${symbol}: ${err.message}`);
    throw err;
  }
}

// Main migration function
async function migrate(): Promise<void> {
  const scriptName = 'migrateToPerStockTables';
  const startedAt = new Date();
  let totalQuotesMigrated = 0;
  let totalHistoricalMigrated = 0;
  let symbolsProcessed = 0;

  // Log script start
  await logScriptStart(scriptName, {
    database: CLICKHOUSE_CONFIG.database,
    host: CLICKHOUSE_CONFIG.host,
  });

  log('='.repeat(60));
  log('Migration: Transfer Data to Per-Stock Tables');
  log('='.repeat(60));
  log(`Database: ${CLICKHOUSE_CONFIG.database}`);
  log(`Host: ${CLICKHOUSE_CONFIG.host}:${CLICKHOUSE_CONFIG.port}`);
  log('='.repeat(60));

  try {
    // Test connection
    await client.ping();
    log('✓ Connection successful');

    // Get all unique symbols from stock_quotes
    log('\n--- Step 1: Getting symbols from stock_quotes ---');
    const quotesSymbols = await getSymbolsFromStockQuotes();
    log(`Found ${quotesSymbols.length} unique symbols in stock_quotes`);

    // Get all unique symbols from historical_data
    log('\n--- Step 2: Getting symbols from historical_data ---');
    const historicalSymbols = await getSymbolsFromHistoricalData();
    log(`Found ${historicalSymbols.length} unique symbols in historical_data`);

    // Combine and deduplicate symbols
    const allSymbols = Array.from(new Set([...quotesSymbols, ...historicalSymbols]));
    log(`\nTotal unique symbols to process: ${allSymbols.length}`);

    // Continue with cleanup even if no symbols found
    if (allSymbols.length === 0) {
      log('No symbols found to migrate. Proceeding with cleanup...');
    }

    // Migrate stock quotes (only if symbols exist)
    if (quotesSymbols.length > 0) {
      log('\n--- Step 3: Migrating stock quotes ---');
      for (const symbol of quotesSymbols) {
        try {
          const count = await migrateStockQuotesForSymbol(symbol);
          totalQuotesMigrated += count;
          symbolsProcessed++;
        } catch (err: any) {
          error(`Failed to migrate quotes for ${symbol}: ${err.message}`);
          // Continue with other symbols
        }
      }
    } else {
      log('\n--- Step 3: Migrating stock quotes ---');
      log('No stock quotes to migrate');
    }

    // Migrate historical data (only if symbols exist)
    if (historicalSymbols.length > 0) {
      log('\n--- Step 4: Migrating historical data ---');
      for (const symbol of historicalSymbols) {
        try {
          const count = await migrateHistoricalDataForSymbol(symbol);
          totalHistoricalMigrated += count;
        } catch (err: any) {
          error(`Failed to migrate historical data for ${symbol}: ${err.message}`);
          // Continue with other symbols
        }
      }
    } else {
      log('\n--- Step 4: Migrating historical data ---');
      log('No historical data to migrate');
    }

    log('\n' + '='.repeat(60));
    log('Migration completed!');
    log('='.repeat(60));
    log(`Symbols processed: ${symbolsProcessed}`);
    log(`Stock quotes migrated: ${totalQuotesMigrated.toLocaleString()} rows`);
    log(`Historical data migrated: ${totalHistoricalMigrated.toLocaleString()} rows`);
    log(`Total rows migrated: ${(totalQuotesMigrated + totalHistoricalMigrated).toLocaleString()}`);

    // Drop old shared tables after successful migration
    log('\n--- Step 5: Removing old shared tables ---');
    try {
      // Drop stock_quotes table
      try {
        await client.exec({
          query: `DROP TABLE IF EXISTS ${CLICKHOUSE_CONFIG.database}.stock_quotes`,
        });
        log('✓ Dropped stock_quotes table');
      } catch (err: any) {
        if (!err?.message?.includes('does not exist') && err?.code !== '60') {
          error(`Failed to drop stock_quotes table: ${err.message}`);
        } else {
          log('stock_quotes table does not exist, skipping...');
        }
      }

      // Drop historical_data table
      try {
        await client.exec({
          query: `DROP TABLE IF EXISTS ${CLICKHOUSE_CONFIG.database}.historical_data`,
        });
        log('✓ Dropped historical_data table');
      } catch (err: any) {
        if (!err?.message?.includes('does not exist') && err?.code !== '60') {
          error(`Failed to drop historical_data table: ${err.message}`);
        } else {
          log('historical_data table does not exist, skipping...');
        }
      }

      // Find and drop all old per-stock tables with stock_ prefix (e.g., stock_AAPL_quotes, stock_AAPL_historical)
      log('\n--- Step 6: Removing old per-stock tables with stock_ prefix ---');
      try {
        // Find all tables matching stock_*_quotes pattern
        const oldQuotesTablesResult = await client.query({
          query: `
            SELECT name
            FROM system.tables
            WHERE database = {db:String}
              AND name LIKE 'stock_%_quotes'
          `,
          query_params: { db: CLICKHOUSE_CONFIG.database },
          format: 'JSONEachRow',
        });
        const oldQuotesTables: any = await oldQuotesTablesResult.json();
        
        for (const table of oldQuotesTables) {
          try {
            await client.exec({
              query: `DROP TABLE IF EXISTS ${CLICKHOUSE_CONFIG.database}.${table.name}`,
            });
            log(`✓ Dropped ${table.name} table`);
          } catch (err: any) {
            error(`Failed to drop ${table.name}: ${err.message}`);
          }
        }

        // Find all tables matching stock_*_historical pattern
        const oldHistoricalTablesResult = await client.query({
          query: `
            SELECT name
            FROM system.tables
            WHERE database = {db:String}
              AND name LIKE 'stock_%_historical'
          `,
          query_params: { db: CLICKHOUSE_CONFIG.database },
          format: 'JSONEachRow',
        });
        const oldHistoricalTables: any = await oldHistoricalTablesResult.json();
        
        for (const table of oldHistoricalTables) {
          try {
            await client.exec({
              query: `DROP TABLE IF EXISTS ${CLICKHOUSE_CONFIG.database}.${table.name}`,
            });
            log(`✓ Dropped ${table.name} table`);
          } catch (err: any) {
            error(`Failed to drop ${table.name}: ${err.message}`);
          }
        }

        const totalOldTables = oldQuotesTables.length + oldHistoricalTables.length;
        if (totalOldTables === 0) {
          log('No old per-stock tables with stock_ prefix found');
        } else {
          log(`✓ Removed ${totalOldTables} old per-stock tables`);
        }
      } catch (err: any) {
        error(`Error removing old per-stock tables: ${err.message}`);
        // Don't fail the migration if table removal fails
      }
    } catch (err: any) {
      error(`Error removing old tables: ${err.message}`);
      // Don't fail the migration if table removal fails
    }

    // Log successful completion (wrap in try-catch to prevent errors from stopping script)
    try {
      await logScriptEnd(
        scriptName,
        startedAt,
        'success',
        totalQuotesMigrated + totalHistoricalMigrated,
        undefined,
        {
          symbols_processed: symbolsProcessed,
          quotes_migrated: totalQuotesMigrated,
          historical_migrated: totalHistoricalMigrated,
          old_tables_removed: true,
        }
      );
    } catch (logErr: any) {
      error(`Failed to log script completion: ${logErr.message}`);
      // Don't fail the script if logging fails
    }

  } catch (err: any) {
    error(`Migration failed: ${err.message}`);
    
    // Log failure (wrap in try-catch to prevent errors from stopping script)
    try {
      await logScriptEnd(
        scriptName,
        startedAt,
        'failed',
        totalQuotesMigrated + totalHistoricalMigrated,
        err.message,
        {
          error_type: err.constructor.name,
          stack: err.stack,
        }
      );
    } catch (logErr: any) {
      error(`Failed to log script failure: ${logErr.message}`);
      // Don't fail the script if logging fails
    }

    process.exit(1);
  } finally {
    // Close connection
    await client.close();
  }
}

// Run migration if this file is executed directly
migrate().catch((err) => {
  error(`Unhandled error: ${err.message}`);
  console.error(err);
  process.exit(1);
});

export { migrate };
