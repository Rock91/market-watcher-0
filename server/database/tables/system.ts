/**
 * System Tables
 * 
 * Tables for system operations and logging
 */

import { clickhouseClient, CLICKHOUSE_CONFIG } from '../client';

export async function initializeSystemTables(): Promise<void> {
  // Create script_execution_log table for tracking script runs
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
}
