// Database configuration
// Helper to strip quotes from env vars if present
const stripQuotes = (value: string | undefined): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || 
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

export const CLICKHOUSE_CONFIG = {
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: process.env.CLICKHOUSE_PORT || '8123',
  username: process.env.CLICKHOUSE_USERNAME || 'default',
  password: stripQuotes(process.env.CLICKHOUSE_PASSWORD),
  database: process.env.CLICKHOUSE_DATABASE || 'market_data',
};

export const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/market_watcher';