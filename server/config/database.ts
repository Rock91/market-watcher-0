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

// Using LOCAL database configuration
// To switch back to environment variables, set USE_ENV_DB=true
const USE_ENV_DB = process.env.USE_ENV_DB === 'true';

export const CLICKHOUSE_CONFIG = USE_ENV_DB ? {
  // Use environment variables (for production/live database)
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: process.env.CLICKHOUSE_PORT || '8123',
  username: process.env.CLICKHOUSE_USERNAME || 'default',
  password: stripQuotes(process.env.CLICKHOUSE_PASSWORD),
  database: process.env.CLICKHOUSE_DATABASE || 'market_data',
} : {
  // Local database configuration (default)
  host: 'localhost',
  port: '8123',
  username: 'default',
  password: '',
  database: 'market_data',
};

export const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/market_watcher';