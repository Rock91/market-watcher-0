# ClickHouse Database Migration

This script migrates data from your live/production ClickHouse database to a local ClickHouse database.

## Prerequisites

1. **Local ClickHouse installed and running**
   ```bash
   # Using Docker (recommended)
   docker run -d -p 8123:8123 -p 9000:9000 --name clickhouse-server clickhouse/clickhouse-server
   
   # Or install locally: https://clickhouse.com/docs/en/install
   ```

2. **Environment Variables** (optional - defaults to .env values for live DB)

   Create a `.env.local` file or set these environment variables:

   ```bash
   # Live/Production Database (source)
   LIVE_CLICKHOUSE_HOST=k0bxa7pc04.europe-west4.gcp.clickhouse.cloud
   LIVE_CLICKHOUSE_PORT=8443
   LIVE_CLICKHOUSE_USERNAME=default
   LIVE_CLICKHOUSE_PASSWORD="your-live-password"
   LIVE_CLICKHOUSE_DATABASE=market_data

   # Local Database (destination)
   LOCAL_CLICKHOUSE_HOST=localhost
   LOCAL_CLICKHOUSE_PORT=8123
   LOCAL_CLICKHOUSE_USERNAME=default
   LOCAL_CLICKHOUSE_PASSWORD=
   LOCAL_CLICKHOUSE_DATABASE=market_data
   ```

   **Note**: If `LIVE_*` variables are not set, the script will use values from your existing `.env` file (which points to live DB).

## Usage

### Basic Migration

```bash
npm run migrate:clickhouse
```

This will:
1. Connect to both live and local databases
2. Create local database and tables if they don't exist
3. Migrate all tables in order:
   - `stock_metadata`
   - `tracked_symbols`
   - `historical_data`
   - `stock_quotes`
   - `market_movers`
   - `trending_symbols`

### Incremental Migration

The script automatically performs **incremental migrations** for time-series tables:
- If local database already has data, it only fetches **new rows** added since the last migration
- This is much faster for subsequent runs

### What Gets Migrated

- **Full migration** (first run): All data from live database
- **Incremental migration** (subsequent runs): Only new data since last migration
- **Batch processing**: Data is migrated in batches of 10,000 rows to avoid memory issues

## Tables Migrated

1. **stock_metadata** - Static stock information
2. **tracked_symbols** - Symbols tracked from market movers
3. **historical_data** - Daily OHLCV price data (up to 2 years)
4. **stock_quotes** - Real-time quote snapshots (up to 1 year)
5. **market_movers** - Daily gainers/losers snapshots (up to 30 days)
6. **trending_symbols** - Trending symbols snapshots (up to 7 days)

## Troubleshooting

### Connection Errors

If you get connection errors:
1. Verify local ClickHouse is running: `curl http://localhost:8123`
2. Check firewall/network settings
3. Verify credentials in environment variables

### Out of Memory

If migration fails due to memory:
- The script processes in batches, but very large tables might still cause issues
- Consider migrating tables individually by modifying the script
- Or increase your system's available memory

### Partial Migration

If migration is interrupted:
- Run the script again - it will resume from where it left off (incremental mode)
- Or manually delete partially migrated tables to start fresh

## Example Output

```
[2025-12-17T23:00:00.000Z] [Migrate] ============================================================
[2025-12-17T23:00:00.000Z] [Migrate] ClickHouse Database Migration Script
[2025-12-17T23:00:00.000Z] [Migrate] ============================================================
[2025-12-17T23:00:00.000Z] [Migrate] Testing Live connection to k0bxa7pc04...:8443...
[2025-12-17T23:00:00.100Z] [Migrate] ✓ Live connection successful
[2025-12-17T23:00:00.200Z] [Migrate] Testing Local connection to localhost:8123...
[2025-12-17T23:00:00.300Z] [Migrate] ✓ Local connection successful
[2025-12-17T23:00:00.400Z] [Migrate] Initializing local database...
[2025-12-17T23:00:01.000Z] [Migrate] ✓ Database 'market_data' ready
[2025-12-17T23:00:01.100Z] [Migrate] ✓ Table 'stock_metadata' created/verified
...
[2025-12-17T23:00:05.000Z] [Migrate] --- Migrating table: stock_quotes ---
[2025-12-17T23:00:05.100Z] [Migrate] Live database has 12,775 rows in stock_quotes
[2025-12-17T23:00:05.200Z] [Migrate] Local database has 0 rows in stock_quotes
[2025-12-17T23:00:05.300Z] [Migrate] Fetching batch 1 (offset: 0)...
[2025-12-17T23:00:06.000Z] [Migrate] ✓ Migrated 10,000 rows (total: 10,000/12,775)
...
```




