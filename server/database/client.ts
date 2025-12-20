/**
 * ClickHouse Database Client
 * 
 * Core database connection and client management
 */

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

export { CLICKHOUSE_CONFIG };
