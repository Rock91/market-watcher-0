/**
 * ClickHouse Database Migration Script
 * 
 * Migrates data from live/production ClickHouse database to local ClickHouse database.
 * 
 * Usage:
 *   npm run migrate:clickhouse
 *   npx tsx server/scripts/migrateClickHouse.ts
 * 
 * Environment Variables:
 *   LIVE_CLICKHOUSE_HOST - Live database host (default: from .env CLICKHOUSE_HOST)
 *   LIVE_CLICKHOUSE_PORT - Live database port (default: from .env CLICKHOUSE_PORT)
 *   LIVE_CLICKHOUSE_USERNAME - Live database username
 *   LIVE_CLICKHOUSE_PASSWORD - Live database password
 *   LIVE_CLICKHOUSE_DATABASE - Live database name
 * 
 *   LOCAL_CLICKHOUSE_HOST - Local database host (default: localhost)
 *   LOCAL_CLICKHOUSE_PORT - Local database port (default: 8123)
 *   LOCAL_CLICKHOUSE_USERNAME - Local database username (default: default)
 *   LOCAL_CLICKHOUSE_PASSWORD - Local database password (default: empty)
 *   LOCAL_CLICKHOUSE_DATABASE - Local database name (default: market_data)
 */

import 'dotenv/config';
import { createClient } from '@clickhouse/client';
import { CLICKHOUSE_CONFIG } from '../config/database';
import { logScriptStart, logScriptEnd } from '../services/clickhouse';

// Live (source) database configuration
const LIVE_CONFIG = {
  host: process.env.CLICKHOUSE_HOST || CLICKHOUSE_CONFIG.host,
  port: process.env.CLICKHOUSE_PORT || CLICKHOUSE_CONFIG.port,
  username: process.env.CLICKHOUSE_USERNAME || CLICKHOUSE_CONFIG.username,
  password: process.env.CLICKHOUSE_PASSWORD || CLICKHOUSE_CONFIG.password,
  database: process.env.CLICKHOUSE_DATABASE || CLICKHOUSE_CONFIG.database,
};

// Local (destination) database configuration
const LOCAL_CONFIG = {
  host: process.env.LOCAL_CLICKHOUSE_HOST || 'localhost',
  port: process.env.LOCAL_CLICKHOUSE_PORT || '8123',
  username: process.env.LOCAL_CLICKHOUSE_USERNAME || 'default',
  password: process.env.LOCAL_CLICKHOUSE_PASSWORD || '',
  database: process.env.LOCAL_CLICKHOUSE_DATABASE || 'market_data',
};

// Determine protocol based on port
const getProtocol = (port: string) => {
  return (port === '8443' || port === '9440') ? 'https' : 'http';
};

// Create clients
const liveClient = createClient({
  url: `${getProtocol(LIVE_CONFIG.port)}://${LIVE_CONFIG.host}:${LIVE_CONFIG.port}`,
  username: LIVE_CONFIG.username,
  password: LIVE_CONFIG.password,
  database: LIVE_CONFIG.database,
  request_timeout: 30000, // 30 seconds for large queries
});

// Create local client with 'default' database first (we'll create target DB in init)
const localClient = createClient({
  url: `${getProtocol(LOCAL_CONFIG.port)}://${LOCAL_CONFIG.host}:${LOCAL_CONFIG.port}`,
  username: LOCAL_CONFIG.username,
  password: LOCAL_CONFIG.password,
  database: 'default', // Use default database initially
  request_timeout: 30000,
});

// Tables to migrate (in order of dependencies)
const TABLES_TO_MIGRATE = [
  'stock_metadata',      // No dependencies
  'tracked_symbols',     // No dependencies
  'historical_data',     // Depends on tracked_symbols (symbols)
  'stock_quotes',        // Depends on tracked_symbols (symbols)
  'market_movers',       // Depends on tracked_symbols (symbols)
  'trending_symbols',    // No dependencies
  'script_execution_log', // Script execution tracking
];

// Logging helper
function log(message: string) {
  console.log(`[${new Date().toISOString()}] [Migrate] ${message}`);
}

function error(message: string) {
  console.error(`[${new Date().toISOString()}] [Migrate] ERROR: ${message}`);
}

// Test connection to a database
async function testConnection(client: typeof liveClient, name: string, config: typeof LIVE_CONFIG): Promise<boolean> {
  try {
    log(`Testing ${name} connection to ${config.host}:${config.port}...`);
    await client.ping();
    log(`✓ ${name} connection successful`);
    return true;
  } catch (err: any) {
    error(`Failed to connect to ${name}: ${err.message}`);
    return false;
  }
}

// Initialize local database and tables
async function initializeLocalDatabase(): Promise<void> {
  try {
    log('Initializing local database...');

    // Create database if it doesn't exist
    await localClient.exec({
      query: `CREATE DATABASE IF NOT EXISTS ${LOCAL_CONFIG.database}`,
    });
    log(`✓ Database '${LOCAL_CONFIG.database}' ready`);

    // Create tables (same schema as in clickhouse.ts)
    const tables = [
      {
        name: 'stock_quotes',
        schema: `
          CREATE TABLE IF NOT EXISTS ${LOCAL_CONFIG.database}.stock_quotes (
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
            currency LowCardinality(String)
          ) ENGINE = MergeTree()
          PARTITION BY toYYYYMM(timestamp)
          ORDER BY (symbol, timestamp)
          TTL timestamp + INTERVAL 1 YEAR
        `,
      },
      {
        name: 'market_movers',
        schema: `
          CREATE TABLE IF NOT EXISTS ${LOCAL_CONFIG.database}.market_movers (
            timestamp DateTime,
            type LowCardinality(String),
            symbol LowCardinality(String),
            name String,
            price Float64,
            change_percent Float64,
            rank UInt32
          ) ENGINE = MergeTree()
          PARTITION BY toYYYYMMDD(timestamp)
          ORDER BY (type, timestamp, rank)
          TTL timestamp + INTERVAL 30 DAY
        `,
      },
      {
        name: 'stock_metadata',
        schema: `
          CREATE TABLE IF NOT EXISTS ${LOCAL_CONFIG.database}.stock_metadata (
            symbol LowCardinality(String),
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
      },
      {
        name: 'historical_data',
        schema: `
          CREATE TABLE IF NOT EXISTS ${LOCAL_CONFIG.database}.historical_data (
            date Date,
            symbol LowCardinality(String),
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
      },
      {
        name: 'trending_symbols',
        schema: `
          CREATE TABLE IF NOT EXISTS ${LOCAL_CONFIG.database}.trending_symbols (
            timestamp DateTime,
            symbol LowCardinality(String),
            name String,
            rank UInt32
          ) ENGINE = MergeTree()
          PARTITION BY toYYYYMMDD(timestamp)
          ORDER BY (timestamp, rank)
          TTL timestamp + INTERVAL 7 DAY
        `,
      },
      {
        name: 'tracked_symbols',
        schema: `
          CREATE TABLE IF NOT EXISTS ${LOCAL_CONFIG.database}.tracked_symbols (
            symbol LowCardinality(String),
            name String,
            last_seen DateTime,
            last_type LowCardinality(String),
            last_rank UInt32,
            last_source LowCardinality(String),
            INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
          ) ENGINE = ReplacingMergeTree(last_seen)
          ORDER BY symbol
        `,
      },
      {
        name: 'script_execution_log',
        schema: `
          CREATE TABLE IF NOT EXISTS ${LOCAL_CONFIG.database}.script_execution_log (
            script_name LowCardinality(String),
            status LowCardinality(String),
            started_at DateTime,
            completed_at Nullable(DateTime),
            duration_ms Nullable(UInt64),
            rows_affected Nullable(UInt64),
            error_message Nullable(String),
            metadata Nullable(String),
            updated_at DateTime DEFAULT now()
          ) ENGINE = ReplacingMergeTree(updated_at)
          PARTITION BY toYYYYMM(started_at)
          ORDER BY (script_name, started_at)
          TTL started_at + INTERVAL 1 YEAR
        `,
      },
    ];

    for (const table of tables) {
      await localClient.exec({ query: table.schema });
      log(`✓ Table '${table.name}' created/verified`);
    }

    log('Local database initialized successfully');
  } catch (err: any) {
    error(`Failed to initialize local database: ${err.message}`);
    throw err;
  }
}

// Get row count from a table
async function getRowCount(client: typeof liveClient, database: string, table: string): Promise<number> {
  try {
    // Check if table exists first
    const tableExists = await client.query({
      query: `
        SELECT count() as count
        FROM system.tables
        WHERE database = {db:String} AND name = {table:String}
      `,
      query_params: { db: database, table },
      format: 'JSONEachRow',
    });
    const existsData: any = await tableExists.json();
    if (!existsData[0] || existsData[0].count === 0) {
      return 0; // Table doesn't exist
    }

    const result = await client.query({
      query: `SELECT count() as count FROM ${database}.${table}`,
      format: 'JSONEachRow',
    });
    const data: any = await result.json();
    return data[0]?.count || 0;
  } catch (err: any) {
    // Silently return 0 if table doesn't exist or query fails
    return 0;
  }
}

// Migrate a single table
async function migrateTable(tableName: string, batchSize: number = 10000): Promise<void> {
  try {
    log(`\n--- Migrating table: ${tableName} ---`);

    // Get row count from live database
    const liveCount = await getRowCount(liveClient, LIVE_CONFIG.database, tableName);
    log(`Live database has ${liveCount.toLocaleString()} rows in ${tableName}`);

    if (liveCount === 0) {
      log(`Skipping ${tableName} (empty table)`);
      return;
    }

    // Check existing rows in local database
    const localCount = await getRowCount(localClient, LOCAL_CONFIG.database, tableName);
    log(`Local database has ${localCount.toLocaleString()} rows in ${tableName}`);

    // Determine date range for incremental migration (last 30 days for time-series tables)
    const timeSeriesTables = ['stock_quotes', 'market_movers', 'trending_symbols'];
    const isTimeSeries = timeSeriesTables.includes(tableName);
    
    let dateFilter = '';
    if (isTimeSeries && localCount > 0) {
      // Get max timestamp from local database
      try {
        const maxResult = await localClient.query({
          query: `SELECT max(timestamp) as max_ts FROM ${LOCAL_CONFIG.database}.${tableName}`,
          format: 'JSONEachRow',
        });
        const maxData: any = await maxResult.json();
        if (maxData[0]?.max_ts) {
          const maxTs = maxData[0].max_ts;
          dateFilter = `WHERE timestamp > '${maxTs}'`;
          log(`Incremental migration: fetching rows after ${maxTs}`);
        }
      } catch (err) {
        // If max query fails, do full migration
        log('Could not determine max timestamp, doing full migration');
      }
    }

    // For historical_data, use date column
    if (tableName === 'historical_data' && localCount > 0) {
      try {
        const maxResult = await localClient.query({
          query: `SELECT max(date) as max_date FROM ${LOCAL_CONFIG.database}.${tableName}`,
          format: 'JSONEachRow',
        });
        const maxData: any = await maxResult.json();
        if (maxData[0]?.max_date) {
          const maxDate = maxData[0].max_date;
          dateFilter = `WHERE date > '${maxDate}'`;
          log(`Incremental migration: fetching rows after ${maxDate}`);
        }
      } catch (err) {
        log('Could not determine max date, doing full migration');
      }
    }

    // Fetch data from live database in batches
    let offset = 0;
    let totalMigrated = 0;
    let batchNumber = 0;

    while (true) {
      batchNumber++;
      const query = `
        SELECT *
        FROM ${LIVE_CONFIG.database}.${tableName}
        ${dateFilter}
        ORDER BY ${tableName === 'historical_data' ? 'date' : 'timestamp'} ASC
        LIMIT ${batchSize}
        OFFSET ${offset}
      `;

      log(`Fetching batch ${batchNumber} (offset: ${offset.toLocaleString()})...`);

      const result = await liveClient.query({
        query,
        format: 'JSONEachRow',
      });

      const rows: any[] = await result.json();

      if (rows.length === 0) {
        log(`No more rows to migrate for ${tableName}`);
        break;
      }

      // Insert into local database
      if (rows.length > 0) {
        await localClient.insert({
          table: `${LOCAL_CONFIG.database}.${tableName}`,
          values: rows,
          format: 'JSONEachRow',
        });

        totalMigrated += rows.length;
        log(`✓ Migrated ${rows.length.toLocaleString()} rows (total: ${totalMigrated.toLocaleString()}/${liveCount.toLocaleString()})`);

        // If we got fewer rows than batch size, we're done
        if (rows.length < batchSize) {
          break;
        }
      }

      offset += batchSize;

      // Small delay to avoid overwhelming the databases
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    log(`✓ Completed migration of ${tableName}: ${totalMigrated.toLocaleString()} rows migrated`);
  } catch (err: any) {
    error(`Failed to migrate ${tableName}: ${err.message}`);
    throw err;
  }
}

// Main migration function
async function migrate(): Promise<void> {
  const scriptName = 'migrateClickHouse';
  const startedAt = new Date();
  let totalRowsMigrated = 0;

  // Log script start
  await logScriptStart(scriptName, {
    source: `${LIVE_CONFIG.host}:${LIVE_CONFIG.port}/${LIVE_CONFIG.database}`,
    destination: `${LOCAL_CONFIG.host}:${LOCAL_CONFIG.port}/${LOCAL_CONFIG.database}`,
    tables: TABLES_TO_MIGRATE,
  });

  log('='.repeat(60));
  log('ClickHouse Database Migration Script');
  log('='.repeat(60));
  log(`Source: ${LIVE_CONFIG.host}:${LIVE_CONFIG.port}/${LIVE_CONFIG.database}`);
  log(`Destination: ${LOCAL_CONFIG.host}:${LOCAL_CONFIG.port}/${LOCAL_CONFIG.database}`);
  log('='.repeat(60));

  try {
    // Test connections
    const liveConnected = await testConnection(liveClient, 'Live', LIVE_CONFIG);
    if (!liveConnected) {
      throw new Error('Cannot connect to live database');
    }

    const localConnected = await testConnection(localClient, 'Local', LOCAL_CONFIG);
    if (!localConnected) {
      throw new Error('Cannot connect to local database');
    }

    // Initialize local database
    await initializeLocalDatabase();

    // Migrate each table
    for (const table of TABLES_TO_MIGRATE) {
      const beforeCount = await getRowCount(localClient, LOCAL_CONFIG.database, table);
      await migrateTable(table);
      const afterCount = await getRowCount(localClient, LOCAL_CONFIG.database, table);
      totalRowsMigrated += (afterCount - beforeCount);
    }

    log('\n' + '='.repeat(60));
    log('Migration completed successfully!');
    log('='.repeat(60));

    // Print summary
    log('\nFinal row counts:');
    for (const table of TABLES_TO_MIGRATE) {
      const localCount = await getRowCount(localClient, LOCAL_CONFIG.database, table);
      log(`  ${table}: ${localCount.toLocaleString()} rows`);
    }

    // Log successful completion
    await logScriptEnd(scriptName, startedAt, 'success', totalRowsMigrated, undefined, {
      tables_migrated: TABLES_TO_MIGRATE.length,
      final_counts: Object.fromEntries(
        await Promise.all(
          TABLES_TO_MIGRATE.map(async (table) => [
            table,
            await getRowCount(localClient, LOCAL_CONFIG.database, table),
          ])
        )
      ),
    });

  } catch (err: any) {
    error(`Migration failed: ${err.message}`);
    
    // Log failure
    await logScriptEnd(scriptName, startedAt, 'failed', totalRowsMigrated, err.message, {
      error_type: err.constructor.name,
      stack: err.stack,
    });

    process.exit(1);
  } finally {
    // Close connections
    await liveClient.close();
    await localClient.close();
  }
}

// Run migration if this file is executed directly
migrate().catch((err) => {
  error(`Unhandled error: ${err.message}`);
  console.error(err);
  process.exit(1);
});

export { migrate };

