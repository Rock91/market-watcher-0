/**
 * Database Utilities
 * 
 * Helper functions for database operations
 */

import { CLICKHOUSE_CONFIG } from '../config/database';

/**
 * Convert JavaScript Date to ClickHouse DateTime string format
 * ClickHouse expects: 'YYYY-MM-DD HH:MM:SS'
 */
export function dateToClickHouseDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
}

/**
 * Sanitize symbol name for use in table name
 * ClickHouse table names must be valid identifiers
 */
export function sanitizeTableName(symbol: string): string {
  // Replace invalid characters with underscore, ensure it starts with a letter or number
  const sanitized = symbol.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
  // Ensure it starts with a letter (prepend 'T' if it starts with a number)
  return /^[0-9]/.test(sanitized) ? `T${sanitized}` : sanitized;
}

/**
 * Get table name for stock quotes
 */
export function getStockQuotesTableName(symbol: string): string {
  return `${CLICKHOUSE_CONFIG.database}.${sanitizeTableName(symbol)}_quotes`;
}

/**
 * Get table name for historical data
 */
export function getHistoricalDataTableName(symbol: string): string {
  return `${CLICKHOUSE_CONFIG.database}.${sanitizeTableName(symbol)}_historical`;
}
