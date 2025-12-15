// Database configuration
export const CLICKHOUSE_CONFIG = {
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: process.env.CLICKHOUSE_PORT || '8123',
  username: process.env.CLICKHOUSE_USERNAME || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'market_data',
};

export const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/market_watcher';