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

// Cache for created per-stock tables to avoid repeated checks
const createdTablesCache = new Set<string>();

/**
 * Check if error is a ClickHouse connection error
 */
function isClickHouseConnectionError(errorMsg: string): boolean {
  return errorMsg.includes('socket hang up') ||
         errorMsg.includes('ECONNREFUSED') ||
         errorMsg.includes('timeout');
}

/**
 * Check if error indicates table doesn't exist
 */
function isClickHouseTableNotFoundError(error: any): boolean {
  const errorMsg = error?.message || String(error);
  const errorCode = (error as any)?.code;
  return errorCode === '60' || errorMsg.includes('does not exist') || error?.type === 'UNKNOWN_TABLE';
}

/**
 * Convert JavaScript Date to ClickHouse DateTime string format
 * ClickHouse expects: 'YYYY-MM-DD HH:MM:SS'
 */
function dateToClickHouseDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
}

/**
 * Convert JavaScript Date to ClickHouse Date string format
 * ClickHouse Date expects: 'YYYY-MM-DD'
 */
function dateToClickHouseDate(date: Date): string {
  return date.toISOString().substring(0, 10);
}

// =============================================================================
// DATABASE OPERATIONS & RELIABILITY
// =============================================================================

/**
 * Database operation result
 */
interface DatabaseOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  retryable?: boolean;
  operationId?: string;
}

/**
 * Batch operation configuration
 */
interface BatchOperationConfig {
  maxBatchSize?: number;
  maxRetries?: number;
  retryDelay?: number;
  continueOnError?: boolean;
  operationTimeout?: number;
}

/**
 * Default batch operation configuration
 */
const DEFAULT_BATCH_CONFIG: BatchOperationConfig = {
  maxBatchSize: 1000,
  maxRetries: 3,
  retryDelay: 1000,
  continueOnError: false,
  operationTimeout: 30000,
};

/**
 * Check if ClickHouse connection is healthy
 */
async function checkConnectionHealth(): Promise<boolean> {
  try {
    await clickhouseClient.query({
      query: 'SELECT 1',
      format: 'JSONEachRow',
    });
    return true;
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] ClickHouse connection health check failed:`, error);
    return false;
  }
}

/**
 * Execute operation with retry logic
 */
async function executeWithRetry<T>(
  operation: () => Promise<T>,
  config: Partial<BatchOperationConfig> = {},
  operationName: string = 'database operation'
): Promise<DatabaseOperationResult<T>> {
  const { maxRetries = 3, retryDelay = 1000 } = { ...DEFAULT_BATCH_CONFIG, ...config };
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      return { success: true, data: result };
    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message || String(error);

      // Check if error is retryable
      const isRetryable = isClickHouseConnectionError(errorMsg) ||
                         errorMsg.includes('timeout') ||
                         errorMsg.includes('connection') ||
                         error.code === 'ECONNRESET';

      console.warn(`[${new Date().toISOString()}] ${operationName} attempt ${attempt}/${maxRetries} failed:`, errorMsg);

      if (!isRetryable || attempt === maxRetries) {
        return {
          success: false,
          error: errorMsg,
          retryable: isRetryable,
        };
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
    }
  }

  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    retryable: true,
  };
}

/**
 * Execute batch insert with proper error handling and rollback logic
 */
async function executeBatchInsert(
  tableName: string,
  values: any[],
  config: Partial<BatchOperationConfig> = {},
  operationName: string = 'batch insert'
): Promise<DatabaseOperationResult<number>> {
  const fullConfig = { ...DEFAULT_BATCH_CONFIG, ...config };
  const { maxBatchSize = 1000, continueOnError = false } = fullConfig;

  if (!values || values.length === 0) {
    return { success: true, data: 0 };
  }

  // Check connection health first
  if (!(await checkConnectionHealth())) {
    return {
      success: false,
      error: 'ClickHouse connection is not healthy',
      retryable: true,
    };
  }

  const batches: any[][] = [];
  for (let i = 0; i < values.length; i += maxBatchSize) {
    batches.push(values.slice(i, i + maxBatchSize));
  }

  let totalInserted = 0;
  let hasErrors = false;
  const errors: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchResult = await executeWithRetry(
      async () => {
        await clickhouseClient.insert({
          table: tableName,
          values: batch,
          format: 'JSONEachRow',
        });
        return batch.length;
      },
      fullConfig,
      `${operationName} (batch ${i + 1}/${batches.length})`
    );

    if (batchResult.success) {
      totalInserted += batchResult.data!;
    } else {
      hasErrors = true;
      errors.push(`Batch ${i + 1}: ${batchResult.error}`);

      if (!continueOnError) {
        // Stop processing further batches on error
        break;
      }
    }
  }

  if (hasErrors) {
    return {
      success: false,
      error: `Batch insert partially failed: ${errors.join('; ')}`,
      data: totalInserted,
    };
  }

  return { success: true, data: totalInserted };
}

/**
 * Execute batch query with proper error handling
 */
async function executeBatchQuery<T = any[]>(
  query: string,
  queryParams: Record<string, any> = {},
  config: Partial<BatchOperationConfig> = {},
  operationName: string = 'batch query'
): Promise<DatabaseOperationResult<T>> {
  return executeWithRetry(
    async () => {
      const result = await clickhouseClient.query({
        query,
        query_params: queryParams,
        format: 'JSONEachRow',
      });
      return await result.json() as T;
    },
    config,
    operationName
  );
}

/**
 * Safe table operation wrapper that handles table creation and existence checks
 */
async function executeTableOperation(
  operation: () => Promise<any>,
  tableName: string,
  operationName: string = 'table operation'
): Promise<DatabaseOperationResult> {
  try {
    // First check if table exists
    const tableCheck = await executeBatchQuery(
      `SHOW TABLES LIKE '${tableName.split('.').pop()}'`,
      {},
      { maxRetries: 1 },
      `table existence check for ${tableName}`
    );

    if (!tableCheck.success) {
      return {
        success: false,
        error: `Cannot verify table ${tableName} exists: ${tableCheck.error}`,
      };
    }

    // Execute the operation
    const result = await executeWithRetry(
      operation,
      { maxRetries: 2 },
      operationName
    );

    return result;
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Table operation failed',
    };
  }
}

/**
 * Create database operation wrapper for consistent error handling
 */
function createDatabaseOperation<T extends any[], R>(
  operation: (...args: T) => Promise<R>,
  operationName: string,
  config: Partial<BatchOperationConfig> = {}
) {
  return async (...args: T): Promise<DatabaseOperationResult<R>> => {
    return executeWithRetry(
      () => operation(...args),
      config,
      operationName
    );
  };
}

// =============================================================================
// ADVANCED BATCHING OPTIMIZATIONS
// =============================================================================

/**
 * Multi-table batch operation - combine inserts to multiple related tables
 */
interface MultiTableBatch {
  tableName: string;
  values: any[];
  priority?: number; // Higher priority executed first
}

/**
 * Execute multi-table batch insert with optimized ordering
 */
async function executeMultiTableBatchInsert(
  batches: MultiTableBatch[],
  config: Partial<BatchOperationConfig> = {},
  operationName: string = 'multi-table batch'
): Promise<DatabaseOperationResult<{ [tableName: string]: number }>> {
  if (!batches || batches.length === 0) {
    return { success: true, data: {} };
  }

  // Sort by priority (higher first) to ensure dependencies are met
  batches.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const results: { [tableName: string]: number } = {};
  let totalOperations = 0;
  const errors: string[] = [];

  // Execute batches sequentially to maintain data integrity
  for (const batch of batches) {
    if (!batch.values || batch.values.length === 0) continue;

    const batchResult = await executeBatchInsert(
      batch.tableName,
      batch.values,
      { ...config, continueOnError: false }, // Don't continue on error for multi-table
      `${operationName} - ${batch.tableName}`
    );

    results[batch.tableName] = batchResult.success ? batchResult.data || 0 : 0;
    totalOperations += results[batch.tableName];

    if (!batchResult.success) {
      errors.push(`${batch.tableName}: ${batchResult.error}`);
      // Stop processing remaining batches on critical failure
      break;
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      error: `Multi-table batch failed: ${errors.join('; ')}`,
      data: results,
    };
  }

  return { success: true, data: results };
}

/**
 * Bulk operation collector - accumulates single operations for batch processing
 */
class BulkOperationCollector {
  private operations: Map<string, { tableName: string; values: any[]; maxBatchSize: number }> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(private flushIntervalMs: number = 5000) {
    this.startAutoFlush();
  }

  /**
   * Add operation to bulk collection
   */
  add(tableName: string, value: any, maxBatchSize: number = 100): void {
    const key = `${tableName}_${maxBatchSize}`;

    if (!this.operations.has(key)) {
      this.operations.set(key, { tableName, values: [], maxBatchSize });
    }

    this.operations.get(key)!.values.push(value);

    // Auto-flush if batch size exceeded
    const op = this.operations.get(key)!;
    if (op.values.length >= op.maxBatchSize) {
      this.flushTable(tableName, maxBatchSize);
    }
  }

  /**
   * Flush specific table operations
   */
  private async flushTable(tableName: string, maxBatchSize: number): Promise<void> {
    const key = `${tableName}_${maxBatchSize}`;
    const op = this.operations.get(key);

    if (!op || op.values.length === 0) return;

    // Remove from collection before processing to prevent duplicate processing
    this.operations.delete(key);

    const result = await executeBatchInsert(
      tableName,
      op.values,
      { maxBatchSize, continueOnError: true },
      `bulk ${tableName} (${op.values.length} records)`
    );

    if (result.success) {
      console.log(`[${new Date().toISOString()}] Bulk inserted ${result.data} records to ${tableName}`);
    } else {
      console.error(`[${new Date().toISOString()}] Bulk insert failed for ${tableName}:`, result.error);
    }
  }

  /**
   * Flush all pending operations
   */
  async flushAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const key of Array.from(this.operations.keys())) {
      const op = this.operations.get(key);
      if (op && op.values.length > 0) {
        promises.push(this.flushTable(op.tableName, op.maxBatchSize));
      }
    }

    this.operations.clear();
    await Promise.allSettled(promises);
  }

  /**
   * Start automatic flushing
   */
  private startAutoFlush(): void {
    this.flushInterval = setInterval(async () => {
      try {
        await this.flushAll();
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Auto-flush failed:`, error);
      }
    }, this.flushIntervalMs);
  }

  /**
   * Stop automatic flushing and flush remaining operations
   */
  async stop(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flushAll();
  }
}

/**
 * Global bulk operation collector instance
 */
export const bulkCollector = new BulkOperationCollector();

/**
 * Smart batch size calculator based on data characteristics
 */
function calculateOptimalBatchSize(data: any[], baseBatchSize: number = 1000): number {
  if (!data || data.length === 0) return baseBatchSize;

  // Sample first few items to estimate data size
  const sampleSize = Math.min(10, data.length);
  let totalSize = 0;

  for (let i = 0; i < sampleSize; i++) {
    totalSize += JSON.stringify(data[i]).length;
  }

  const avgSize = totalSize / sampleSize;

  // Adjust batch size based on item size
  // Larger items = smaller batches to prevent memory issues
  if (avgSize > 10000) return Math.max(10, baseBatchSize / 10); // Very large items
  if (avgSize > 5000) return Math.max(50, baseBatchSize / 5);   // Large items
  if (avgSize > 1000) return Math.max(100, baseBatchSize / 2);  // Medium items
  if (avgSize < 100) return Math.min(5000, baseBatchSize * 2);  // Small items

  return baseBatchSize; // Normal items
}

/**
 * Parallel batch executor - run multiple independent batches concurrently
 */
async function executeParallelBatches(
  batchOperations: Array<{
    tableName: string;
    values: any[];
    config?: Partial<BatchOperationConfig>;
    operationName?: string;
  }>
): Promise<DatabaseOperationResult<{ [key: string]: number }>> {
  if (!batchOperations || batchOperations.length === 0) {
    return { success: true, data: {} };
  }

  const results: { [key: string]: number } = {};
  const promises = batchOperations.map(async (op, index) => {
    const result = await executeBatchInsert(
      op.tableName,
      op.values,
      op.config || {},
      op.operationName || `parallel batch ${index + 1}`
    );

    return {
      key: `${op.tableName}_${index}`,
      success: result.success,
      data: result.data || 0,
      error: result.error,
    };
  });

  const settledResults = await Promise.allSettled(promises);
  let hasErrors = false;
  const errors: string[] = [];

  for (const result of settledResults) {
    if (result.status === 'fulfilled') {
      const { key, success, data, error } = result.value;
      results[key] = success ? data : 0;

      if (!success) {
        hasErrors = true;
        errors.push(`${key}: ${error}`);
      }
    } else {
      hasErrors = true;
      errors.push(`Promise rejected: ${result.reason}`);
    }
  }

  if (hasErrors) {
    return {
      success: false,
      error: `Parallel batch execution failed: ${errors.join('; ')}`,
      data: results,
    };
  }

  return { success: true, data: results };
}

/**
 * Combined market data batch insert - optimize related data insertion
 */
export async function insertMarketDataBatch(
  marketMovers?: any[],
  trendingSymbols?: any[],
  trackedSymbols?: any[]
): Promise<DatabaseOperationResult<{ [key: string]: number }>> {
  const batches: MultiTableBatch[] = [];

  // Add market movers (highest priority)
  if (marketMovers && marketMovers.length > 0) {
    const validMovers = validateData(marketMovers, (mover: any): mover is MarketMoversSchema => {
      if (!mover || typeof mover !== 'object') return false;
      return validateMarketMovers({...mover, type: 'gainers'}); // Default type
    }, 'MarketMoversBatch');

    if (validMovers.length > 0) {
      const timestamp = new Date();
      const timestampStr = dateToClickHouseDateTime(timestamp);
      const values = validMovers.map((mover, index) => ({
        timestamp: timestampStr,
        type: mover.type,
        symbol: mover.symbol,
        name: mover.name,
        price: mover.price,
        change_percent: mover.change_percent || mover.changePercent || 0,
        volume: mover.volume || 0,
        currency: mover.currency || 'USD',
        rank: index + 1
      }));

      batches.push({
        tableName: `${CLICKHOUSE_CONFIG.database}.market_movers`,
        values,
        priority: 10, // High priority
      });
    }
  }

  // Add trending symbols
  if (trendingSymbols && trendingSymbols.length > 0) {
    const validSymbols = validateData(trendingSymbols, validateTrendingSymbols, 'TrendingSymbolsBatch');

    if (validSymbols.length > 0) {
      const timestamp = new Date();
      const timestampStr = dateToClickHouseDateTime(timestamp);
      const values = validSymbols.map((item: any, index: number) => ({
        timestamp: timestampStr,
        symbol: item.symbol,
        name: item.shortName || item.longName || item.symbol,
        rank: index + 1,
      }));

      batches.push({
        tableName: `${CLICKHOUSE_CONFIG.database}.trending_symbols`,
        values,
        priority: 5, // Medium priority
      });
    }
  }

  // Add tracked symbols (lowest priority, depends on market data)
  if (trackedSymbols && trackedSymbols.length > 0) {
    const validSymbols = validateData(trackedSymbols, validateTrackedSymbols, 'TrackedSymbolsBatch');

    if (validSymbols.length > 0) {
      const lastSeen = new Date();
      const lastSeenStr = dateToClickHouseDateTime(lastSeen);
      const values = validSymbols.map((symbol: any) => ({
        symbol: symbol.symbol,
        name: symbol.name || symbol.shortName || symbol.longName || symbol.symbol,
        last_source: symbol.last_source || 'batch_import',
        last_type: symbol.last_type || null,
        last_rank: symbol.last_rank || null,
        last_seen: lastSeenStr,
      }));

      batches.push({
        tableName: `${CLICKHOUSE_CONFIG.database}.tracked_symbols`,
        values,
        priority: 1, // Low priority
      });
    }
  }

  return executeMultiTableBatchInsert(
    batches,
    { maxBatchSize: 1000, continueOnError: false },
    'combined market data batch'
  );
}

// =============================================================================
// SCHEMA INTERFACES AND VALIDATION
// =============================================================================

/**
 * Stock Quote Schema Interface
 */
export interface StockQuoteSchema {
  symbol: string;
  timestamp: Date;
  price: number;
  change: number;
  change_percent: number;
  volume: number;
  market_cap?: number;
  pe_ratio?: number;
  day_high?: number;
  day_low?: number;
  day_open?: number;
  previous_close?: number;
  currency: string;
}

/**
 * Historical Data Schema Interface
 */
export interface HistoricalDataSchema {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adj_close?: number;
}

/**
 * Market Movers Schema Interface
 */
export interface MarketMoversSchema {
  timestamp: Date;
  type: 'gainers' | 'losers';
  symbol: string;
  name: string;
  shortName?: string;
  longName?: string;
  price: number;
  change?: number;
  change_percent?: number;
  changePercent?: number;
  volume?: number;
  currency?: string;
  rank?: number;
}

/**
 * Stock Metadata Schema Interface
 */
export interface StockMetadataSchema {
  symbol: string;
  name: string;
  sector?: string;
  industry?: string;
  country?: string;
  market_cap?: number;
  pe_ratio?: number;
  dividend_yield?: number;
  beta?: number;
}

/**
 * Trending Symbols Schema Interface
 */
export interface TrendingSymbolsSchema {
  timestamp: Date;
  symbol: string;
  name: string;
  rank: number;
}

/**
 * Tracked Symbols Schema Interface
 */
export interface TrackedSymbolsSchema {
  symbol: string;
  name: string;
  last_source: string;
  last_type?: string;
  last_rank?: number;
  last_seen: Date;
}

/**
 * Script Execution Log Schema Interface
 */
export interface ScriptExecutionLogSchema {
  script_name: string;
  status: 'success' | 'failed' | 'running';
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;
  error_message?: string;
  metadata?: string;
}

/**
 * AI Strategy Results Schema Interface
 */
export interface AIStrategyResultsSchema {
  timestamp: Date;
  symbol: string;
  strategy: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  price: number;
  reason?: string;
  indicators?: string;
}

/**
 * Trade History Schema Interface
 */
export interface TradeHistorySchema {
  trade_id: string;
  signal_id: string | null;
  timestamp: Date;
  symbol: string;
  action: 'BUY' | 'SELL';
  strategy: string;
  entry_price: number;
  quantity: number;
  investment_amount: number;
  confidence: number;
  exit_price?: number;
  exit_timestamp?: Date;
  profit_loss?: number;
  profit_loss_percent?: number;
  status: 'open' | 'closed' | 'cancelled';
  reason: string;
}

/**
 * Validate Stock Quote data
 */
function validateStockQuote(data: any): data is StockQuoteSchema {
  if (!data || typeof data !== 'object') return false;

  // Required fields
  if (typeof data.symbol !== 'string' || !data.symbol) return false;
  if (typeof data.price !== 'number' || isNaN(data.price)) return false;
  if (typeof data.change !== 'number' || isNaN(data.change)) return false;
  if (typeof data.change_percent !== 'number' || isNaN(data.change_percent)) return false;
  if (typeof data.volume !== 'number' || isNaN(data.volume)) return false;
  if (typeof data.currency !== 'string' || !data.currency) return false;

  // Timestamp validation
  if (!(data.timestamp instanceof Date) && typeof data.timestamp !== 'string') return false;

  // Optional numeric fields
  const optionalNumbers = ['market_cap', 'pe_ratio', 'day_high', 'day_low', 'day_open', 'previous_close'];
  for (const field of optionalNumbers) {
    if (data[field] !== undefined && (typeof data[field] !== 'number' || isNaN(data[field]))) return false;
  }

  return true;
}

/**
 * Validate Historical Data
 */
function validateHistoricalData(data: any): data is HistoricalDataSchema {
  if (!data || typeof data !== 'object') return false;

  // Required numeric fields
  const requiredNumbers = ['open', 'high', 'low', 'close', 'volume'];
  for (const field of requiredNumbers) {
    if (typeof data[field] !== 'number' || isNaN(data[field])) return false;
  }

  // Date validation
  if (!(data.date instanceof Date) && typeof data.date !== 'string') return false;

  // Optional adj_close
  if (data.adj_close !== undefined && (typeof data.adj_close !== 'number' || isNaN(data.adj_close))) return false;

  return true;
}

/**
 * Validate Market Movers data
 */
function validateMarketMovers(data: any): data is MarketMoversSchema {
  if (!data || typeof data !== 'object') return false;

  // Required fields
  if (!['gainers', 'losers'].includes(data.type)) return false;
  if (typeof data.symbol !== 'string' || !data.symbol) return false;
  if (typeof data.name !== 'string' || !data.name) return false;
  if (typeof data.price !== 'number' || isNaN(data.price)) return false;

  // Timestamp validation
  if (!(data.timestamp instanceof Date) && typeof data.timestamp !== 'string') return false;

  // Optional numeric fields
  const optionalNumbers = ['change', 'change_percent', 'changePercent', 'volume', 'rank'];
  for (const field of optionalNumbers) {
    if (data[field] !== undefined && (typeof data[field] !== 'number' || isNaN(data[field]))) return false;
  }

  // Optional string fields
  const optionalStrings = ['currency', 'shortName', 'longName'];
  for (const field of optionalStrings) {
    if (data[field] !== undefined && typeof data[field] !== 'string') return false;
  }

  return true;
}

/**
 * Validate Stock Metadata
 */
function validateStockMetadata(data: any): data is StockMetadataSchema {
  if (!data || typeof data !== 'object') return false;

  // Required fields
  if (typeof data.symbol !== 'string' || !data.symbol) return false;
  if (typeof data.name !== 'string' || !data.name) return false;

  // Optional string fields
  const optionalStrings = ['sector', 'industry', 'country'];
  for (const field of optionalStrings) {
    if (data[field] !== undefined && typeof data[field] !== 'string') return false;
  }

  // Optional numeric fields
  const optionalNumbers = ['market_cap', 'pe_ratio', 'dividend_yield', 'beta'];
  for (const field of optionalNumbers) {
    if (data[field] !== undefined && (typeof data[field] !== 'number' || isNaN(data[field]))) return false;
  }

  return true;
}

/**
 * Validate Trending Symbols data
 */
function validateTrendingSymbols(data: any): data is TrendingSymbolsSchema {
  if (!data || typeof data !== 'object') return false;

  // Required fields
  if (typeof data.symbol !== 'string' || !data.symbol) return false;
  if (typeof data.name !== 'string' || !data.name) return false;
  if (typeof data.rank !== 'number' || isNaN(data.rank) || data.rank < 1) return false;

  // Timestamp validation
  if (!(data.timestamp instanceof Date) && typeof data.timestamp !== 'string') return false;

  return true;
}

/**
 * Validate Tracked Symbols data
 */
function validateTrackedSymbols(data: any): data is TrackedSymbolsSchema {
  if (!data || typeof data !== 'object') return false;

  // Required fields
  if (typeof data.symbol !== 'string' || !data.symbol) return false;
  if (typeof data.name !== 'string' || !data.name) return false;
  if (typeof data.last_source !== 'string' || !data.last_source) return false;

  // Date validation
  if (!(data.last_seen instanceof Date) && typeof data.last_seen !== 'string') return false;

  // Optional fields
  if (data.last_type !== undefined && typeof data.last_type !== 'string') return false;
  if (data.last_rank !== undefined && (typeof data.last_rank !== 'number' || isNaN(data.last_rank))) return false;

  return true;
}

/**
 * Validate Script Execution Log data
 */
function validateScriptExecutionLog(data: any): data is ScriptExecutionLogSchema {
  if (!data || typeof data !== 'object') return false;

  // Required fields
  if (typeof data.script_name !== 'string' || !data.script_name) return false;
  if (!['success', 'failed', 'running'].includes(data.status)) return false;

  // Date validation
  if (!(data.started_at instanceof Date) && typeof data.started_at !== 'string') return false;

  // Optional fields
  if (data.completed_at !== undefined && !(data.completed_at instanceof Date) && typeof data.completed_at !== 'string') return false;
  if (data.duration_ms !== undefined && (typeof data.duration_ms !== 'number' || isNaN(data.duration_ms))) return false;
  if (data.error_message !== undefined && typeof data.error_message !== 'string') return false;
  if (data.metadata !== undefined && typeof data.metadata !== 'string') return false;

  return true;
}

/**
 * Validate AI Strategy Results data
 */
function validateAIStrategyResults(data: any): data is AIStrategyResultsSchema {
  if (!data || typeof data !== 'object') return false;

  // Required fields
  if (typeof data.symbol !== 'string' || !data.symbol) return false;
  if (typeof data.strategy !== 'string' || !data.strategy) return false;
  if (!['BUY', 'SELL', 'HOLD'].includes(data.action)) return false;
  if (typeof data.confidence !== 'number' || isNaN(data.confidence) || data.confidence < 0 || data.confidence > 1) return false;
  if (typeof data.price !== 'number' || isNaN(data.price)) return false;

  // Timestamp validation
  if (!(data.timestamp instanceof Date) && typeof data.timestamp !== 'string') return false;

  // Optional fields
  if (data.reason !== undefined && typeof data.reason !== 'string') return false;
  if (data.indicators !== undefined && typeof data.indicators !== 'string') return false;

  return true;
}

/**
 * Validate Trade History data
 */
function validateTradeHistory(data: any): data is TradeHistorySchema {
  if (!data || typeof data !== 'object') return false;

  // Required fields
  if (typeof data.trade_id !== 'string' || !data.trade_id) return false;
  if (data.signal_id !== null && typeof data.signal_id !== 'string') return false;
  if (typeof data.symbol !== 'string' || !data.symbol) return false;
  if (!['BUY', 'SELL'].includes(data.action)) return false;
  if (typeof data.strategy !== 'string' || !data.strategy) return false;
  if (typeof data.entry_price !== 'number' || isNaN(data.entry_price)) return false;
  if (typeof data.quantity !== 'number' || isNaN(data.quantity)) return false;
  if (typeof data.investment_amount !== 'number' || isNaN(data.investment_amount)) return false;
  if (typeof data.confidence !== 'number' || isNaN(data.confidence)) return false;
  if (!['open', 'closed', 'cancelled'].includes(data.status)) return false;
  if (typeof data.reason !== 'string' || !data.reason) return false;

  // Timestamp validation
  if (!(data.timestamp instanceof Date) && typeof data.timestamp !== 'string') return false;

  // Optional numeric fields
  const optionalNumbers = ['exit_price', 'profit_loss', 'profit_loss_percent'];
  for (const field of optionalNumbers) {
    if (data[field] !== undefined && (typeof data[field] !== 'number' || isNaN(data[field]))) return false;
  }

  // Optional exit timestamp
  if (data.exit_timestamp !== undefined && !(data.exit_timestamp instanceof Date) && typeof data.exit_timestamp !== 'string') return false;

  return true;
}

/**
 * Generic schema validation wrapper with error logging
 */
function validateData<T>(data: any[], validator: (item: any) => item is T, schemaName: string): T[] {
  const validData: T[] = [];
  const invalidItems: any[] = [];

  for (const item of data) {
    if (validator(item)) {
      validData.push(item as T);
    } else {
      invalidItems.push(item);
    }
  }

  if (invalidItems.length > 0) {
    console.warn(`[${new Date().toISOString()}] Schema validation failed for ${schemaName}: ${invalidItems.length} invalid items out of ${data.length} total`);
    console.warn(`[${new Date().toISOString()}] Invalid ${schemaName} samples:`, invalidItems.slice(0, 3));
  }

  return validData;
}

// Sanitize symbol name for use in table name (ClickHouse table names must be valid identifiers)
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

// Create per-stock quotes table if it doesn't exist
async function ensureStockQuotesTable(symbol: string): Promise<void> {
  const tableName = getStockQuotesTableName(symbol);
  const cacheKey = `quotes_${symbol}`;
  
  if (createdTablesCache.has(cacheKey)) {
    return; // Already created in this session
  }

  try {
    await clickhouseClient.exec({
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
          day_open Float64,
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
    
    // Add day_open column to existing tables if it doesn't exist (migration)
    try {
      await clickhouseClient.exec({
        query: `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS day_open Float64 DEFAULT 0`,
      });
    } catch (migrationError: any) {
      // Ignore errors if column already exists or table doesn't exist
      if (!migrationError?.message?.includes('already exists') && !migrationError?.message?.includes('does not exist')) {
        console.warn(`[${new Date().toISOString()}] Could not add day_open column to ${tableName}:`, migrationError?.message);
      }
    }
    
    createdTablesCache.add(cacheKey);
  } catch (error: any) {
    // If table already exists, add to cache anyway
    if (error?.message?.includes('already exists') || error?.code === '57') {
      createdTablesCache.add(cacheKey);
    } else {
      throw error;
    }
  }
}

// Create per-stock historical data table if it doesn't exist
async function ensureHistoricalDataTable(symbol: string): Promise<void> {
  const tableName = getHistoricalDataTableName(symbol);
  const cacheKey = `historical_${symbol}`;
  
  if (createdTablesCache.has(cacheKey)) {
    return; // Already created in this session
  }

  try {
    await clickhouseClient.exec({
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
    createdTablesCache.add(cacheKey);
  } catch (error: any) {
    // If table already exists, add to cache anyway
    if (error?.message?.includes('already exists') || error?.code === '57') {
      createdTablesCache.add(cacheKey);
    } else {
      throw error;
    }
  }
}

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
          symbol LowCardinality(String),
          price Float64,
          change Float64,
          change_percent Float64,
          volume UInt64,
          market_cap UInt64,
          pe_ratio Float64,
          day_high Float64,
          day_low Float64,
          day_open Float64,
          previous_close Float64,
          currency LowCardinality(String),
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
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
          type LowCardinality(String), -- 'gainers' or 'losers'
          symbol LowCardinality(String),
          name String,
          price Float64,
          change_percent Float64,
          volume UInt64,
          currency LowCardinality(String),
          rank UInt32, -- position in the list (1-20)
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
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
          symbol LowCardinality(String),
          open Float64,
          high Float64,
          low Float64,
          close Float64,
          volume UInt64,
          adj_close Float64,
          fetched_at DateTime DEFAULT now(),
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
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
          symbol LowCardinality(String),
          name String,
          rank UInt32,
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMMDD(timestamp)
        ORDER BY (timestamp, rank)
        TTL timestamp + INTERVAL 7 DAY
      `,
    });

    // Create tracked_symbols table (derived from market movers; drives historical backfill)
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.tracked_symbols (
          symbol LowCardinality(String),
          name String,
          last_source LowCardinality(String), -- e.g. 'market_movers'
          last_type LowCardinality(String),   -- 'gainers' or 'losers'
          last_rank UInt32,
          last_seen DateTime,
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1
        ) ENGINE = ReplacingMergeTree(last_seen)
        PARTITION BY toYYYYMMDD(last_seen)
        ORDER BY symbol
        TTL last_seen + INTERVAL 30 DAY
      `,
    });

    // Create script_execution_log table for tracking script runs
    // Using ReplacingMergeTree with updated_at to allow updates
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

    // Create technical_indicators table for storing RSI, MACD, and Volatility
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.technical_indicators (
          date Date,
          symbol LowCardinality(String),
          rsi Float64,
          macd_value Float64,
          macd_signal Float64,
          macd_histogram Float64,
          volatility Float64,
          volatility_percent Float64,
          data_points UInt32,
          calculated_at DateTime DEFAULT now(),
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1,
          INDEX date_idx date TYPE minmax GRANULARITY 3
        ) ENGINE = ReplacingMergeTree(calculated_at)
        PARTITION BY toYYYYMM(date)
        ORDER BY (symbol, date)
        TTL date + INTERVAL 1 YEAR
      `,
    });

    // Create AI strategy results table (stores all strategy runs on all stocks)
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.ai_strategy_results (
          timestamp DateTime,
          symbol LowCardinality(String),
          strategy LowCardinality(String),
          action LowCardinality(String),
          confidence Float64,
          reason String,
          price Float64,
          rsi Nullable(Float64),
          macd Nullable(Float64),
          bb_upper Nullable(Float64),
          bb_middle Nullable(Float64),
          bb_lower Nullable(Float64),
          sma20 Nullable(Float64),
          sma50 Nullable(Float64),
          ema12 Nullable(Float64),
          ema26 Nullable(Float64),
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1,
          INDEX strategy_idx strategy TYPE bloom_filter GRANULARITY 1,
          INDEX confidence_idx confidence TYPE minmax GRANULARITY 3,
          INDEX timestamp_idx timestamp TYPE minmax GRANULARITY 3
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (symbol, timestamp, strategy)
        TTL timestamp + INTERVAL 30 DAY
      `,
    });

    // Create AI signals table (high confidence signals > 75%)
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.ai_signals (
          signal_id String,
          timestamp DateTime,
          symbol LowCardinality(String),
          strategy LowCardinality(String),
          action LowCardinality(String),
          confidence Float64,
          reason String,
          price Float64,
          status LowCardinality(String),
          executed_at Nullable(DateTime),
          trade_id Nullable(String),
          updated_at DateTime DEFAULT now(),
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1,
          INDEX status_idx status TYPE bloom_filter GRANULARITY 1,
          INDEX confidence_idx confidence TYPE minmax GRANULARITY 3
        ) ENGINE = ReplacingMergeTree(updated_at)
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (symbol, timestamp)
        TTL timestamp + INTERVAL 90 DAY
      `,
    });

    // Create trade history table
    await clickhouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_CONFIG.database}.trade_history (
          trade_id String,
          signal_id String,
          timestamp DateTime,
          symbol LowCardinality(String),
          action LowCardinality(String),
          strategy LowCardinality(String),
          entry_price Float64,
          quantity UInt32,
          investment_amount Float64,
          confidence Float64,
          exit_price Nullable(Float64),
          exit_timestamp Nullable(DateTime),
          profit_loss Nullable(Float64),
          profit_loss_percent Nullable(Float64),
          status LowCardinality(String),
          reason String,
          updated_at DateTime DEFAULT now(),
          INDEX symbol_bf symbol TYPE bloom_filter GRANULARITY 1,
          INDEX status_idx status TYPE bloom_filter GRANULARITY 1,
          INDEX timestamp_idx timestamp TYPE minmax GRANULARITY 3
        ) ENGINE = ReplacingMergeTree(updated_at)
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (symbol, timestamp)
        TTL timestamp + INTERVAL 1 YEAR
      `,
    });

    // Best-effort: apply optimizations to existing tables (safe to ignore failures)
    const tryExec = async (query: string) => {
      try {
        await clickhouseClient.exec({ query });
      } catch (e: any) {
        // Don't fail server startup over optional optimizations
        console.warn(`[${new Date().toISOString()}] ClickHouse optimization skipped: ${e?.message || e}`);
      }
    };

    // LowCardinality columns reduce memory/IO for repetitive strings (symbol/type/currency)
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.stock_quotes MODIFY COLUMN symbol LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.stock_quotes MODIFY COLUMN currency LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.market_movers MODIFY COLUMN type LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.market_movers MODIFY COLUMN symbol LowCardinality(String)`);
    // Add volume and currency columns if they don't exist (for backward compatibility)
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.market_movers ADD COLUMN IF NOT EXISTS volume UInt64 DEFAULT 0`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.market_movers ADD COLUMN IF NOT EXISTS currency LowCardinality(String) DEFAULT 'USD'`);
    // Add day_open column if it doesn't exist (for backward compatibility)
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.stock_quotes ADD COLUMN IF NOT EXISTS day_open Float64 DEFAULT 0`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.historical_data MODIFY COLUMN symbol LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.trending_symbols MODIFY COLUMN symbol LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.tracked_symbols MODIFY COLUMN symbol LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.tracked_symbols MODIFY COLUMN last_source LowCardinality(String)`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.tracked_symbols MODIFY COLUMN last_type LowCardinality(String)`);

    // Bloom filter indexes can speed up symbol IN (...) and high-selectivity filters
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.stock_quotes ADD INDEX IF NOT EXISTS symbol_bf symbol TYPE bloom_filter GRANULARITY 1`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.market_movers ADD INDEX IF NOT EXISTS symbol_bf symbol TYPE bloom_filter GRANULARITY 1`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.historical_data ADD INDEX IF NOT EXISTS symbol_bf symbol TYPE bloom_filter GRANULARITY 1`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.trending_symbols ADD INDEX IF NOT EXISTS symbol_bf symbol TYPE bloom_filter GRANULARITY 1`);
    await tryExec(`ALTER TABLE ${CLICKHOUSE_CONFIG.database}.tracked_symbols ADD INDEX IF NOT EXISTS symbol_bf symbol TYPE bloom_filter GRANULARITY 1`);

    console.log(`[${new Date().toISOString()}] ClickHouse database initialized successfully`);
  } catch (error: any) {

    const errorMsg = error?.message || String(error);
    const errorCode = (error as any)?.code;
    const errorType = (error as any)?.type;
    
    if (isClickHouseConnectionError(errorMsg)) {
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

// Store multiple stock quotes in a single ClickHouse insert (much faster than per-row inserts)
// Store multiple stock quotes with robust batch processing and error handling
export async function storeStockQuotes(quotes: any[], timestamp: Date = new Date()) {
  // Validate and filter data
  const validQuotes = validateData(quotes, validateStockQuote, 'StockQuotes');
  if (validQuotes.length === 0) {
    console.warn(`[${new Date().toISOString()}] No valid stock quotes to store`);
    return;
  }

  // Prepare data for optimized batch insert
  const timestampStr = dateToClickHouseDateTime(timestamp);
  const quotesBySymbol = new Map<string, any[]>();

  // Group quotes by symbol to insert into per-stock tables
  for (const quote of validQuotes) {
    const symbol = quote.symbol;
    if (!symbol) continue;

    if (!quotesBySymbol.has(symbol)) {
      quotesBySymbol.set(symbol, []);
    }
    quotesBySymbol.get(symbol)!.push({
      timestamp: timestampStr,
      price: quote.price || 0,
      change: quote.change || 0,
      change_percent: quote.change_percent || 0,
      volume: quote.volume || 0,
      market_cap: quote.market_cap || null,
      pe_ratio: quote.pe_ratio || null,
      day_high: quote.day_high || null,
      day_low: quote.day_low || null,
      day_open: quote.day_open || null,
      previous_close: quote.previous_close || null,
      currency: quote.currency || 'USD',
    });
  }

  // Execute batch inserts for each symbol with proper error handling
  const insertPromises: Promise<DatabaseOperationResult<number>>[] = [];
  for (const symbol of Array.from(quotesBySymbol.keys())) {
    const symbolQuotes = quotesBySymbol.get(symbol)!;
    if (!symbolQuotes || symbolQuotes.length === 0) continue;

    // Ensure table exists first
    try {
      await ensureStockQuotesTable(symbol);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Failed to ensure table for ${symbol}:`, error);
      continue;
    }

    const tableName = getStockQuotesTableName(symbol);
    const optimalBatchSize = calculateOptimalBatchSize(symbolQuotes, 500);
    insertPromises.push(
      executeBatchInsert(tableName, symbolQuotes, { maxBatchSize: optimalBatchSize }, `stock quotes for ${symbol}`)
    );
  }

  // Wait for all inserts to complete
  const results = await Promise.allSettled(insertPromises);
  let totalInserted = 0;
  let hasErrors = false;
  let errorCount = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.success) {
        totalInserted += result.value.data || 0;
      } else {
        hasErrors = true;
        errorCount++;
        console.error(`[${new Date().toISOString()}] Stock quotes batch insert failed:`, result.value.error);
      }
    } else {
      hasErrors = true;
      errorCount++;
      console.error(`[${new Date().toISOString()}] Stock quotes batch insert promise rejected:`, result.reason);
    }
  }

  if (totalInserted > 0) {
    console.log(`[${new Date().toISOString()}] Successfully stored ${totalInserted} stock quotes across ${quotesBySymbol.size} symbols`);
  }

  if (hasErrors) {
    console.warn(`[${new Date().toISOString()}] ${errorCount} stock quote insertions failed out of ${insertPromises.length} batches - check logs for details`);
  }
}

// Store stock quote data
export async function storeStockQuote(quote: any) {
  return storeStockQuotes([quote]);
}

// Store market movers data with robust batch processing
export async function storeMarketMovers(type: 'gainers' | 'losers', movers: any[]) {
  // Validate and filter data
  const validMovers = validateData(movers, (mover: any): mover is MarketMoversSchema => {
    if (!mover || typeof mover !== 'object') return false;
    return validateMarketMovers({...mover, type});
  }, 'MarketMovers');
  if (validMovers.length === 0) {
    console.warn(`[${new Date().toISOString()}] No valid market movers to store`);
    return;
  }

  const timestamp = new Date(); // single snapshot timestamp for all rows
  const timestampStr = dateToClickHouseDateTime(timestamp);
  const values = validMovers.map((mover, index) => ({
    timestamp: timestampStr,
    type,
    symbol: mover.symbol,
    name: mover.name,
    price: mover.price,
    change_percent: mover.change_percent || mover.changePercent || 0,
    volume: mover.volume || 0,
    currency: mover.currency || 'USD',
    rank: index + 1
  }));

  const result = await executeBatchInsert(
    `${CLICKHOUSE_CONFIG.database}.market_movers`,
    values,
    { maxBatchSize: 1000, continueOnError: false },
    `market movers (${type})`
  );

  if (result.success) {
    console.log(`[${new Date().toISOString()}] Successfully stored ${result.data} ${type} in ClickHouse`);
  } else {
    console.error(`[${new Date().toISOString()}] Failed to store market movers (${type}):`, result.error);
  }
}

// Upsert tracked symbols based on market movers (drives historical backfill list)
export async function storeTrackedSymbolsFromMovers(
  type: 'gainers' | 'losers',
  movers: any[],
  source: string = 'market_movers',
) {
  try {
    if (!movers || movers.length === 0) {
      console.log(`[${new Date().toISOString()}] No movers to track for ${type}`);
      return;
    }

    // Validate and filter data
    const validMovers = validateData(movers, (mover: any): mover is MarketMoversSchema => {
      if (!mover || typeof mover !== 'object') return false;
      return validateMarketMovers({...mover, type});
    }, 'TrackedSymbolsMovers');
    if (validMovers.length === 0) {
      console.warn(`[${new Date().toISOString()}] No valid movers to track for ${type}`);
      return;
    }

    const lastSeen = new Date();
    const lastSeenStr = dateToClickHouseDateTime(lastSeen);

    const values = validMovers.map((mover, index) => ({
      symbol: mover.symbol,
      name: mover.name || mover.shortName || mover.longName || mover.symbol,
      last_source: source,
      last_type: type,
      last_rank: index + 1,
      last_seen: lastSeenStr,
    }));

    const result = await executeBatchInsert(
      `${CLICKHOUSE_CONFIG.database}.tracked_symbols`,
      values,
      { maxBatchSize: 1000, continueOnError: false },
      `tracked symbols from ${type}`
    );

    if (result.success) {
      console.log(`[${new Date().toISOString()}] Successfully stored ${result.data} tracked symbols from ${type} (source: ${source})`);
    } else {
      console.error(`[${new Date().toISOString()}] Failed to store tracked symbols from ${type}:`, result.error);
    }
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error storing tracked symbols from ${type}:`, error.message);
    // Don't throw - allow script to continue
  }
}

// Get tracked symbols from ClickHouse (de-duplicated)
export async function getTrackedSymbols(days: number = 7, limit: number = 1000): Promise<Array<{ symbol: string; name?: string }>> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT
          symbol,
          anyLast(name) AS name
        FROM ${CLICKHOUSE_CONFIG.database}.tracked_symbols FINAL
        WHERE last_seen >= now() - INTERVAL {days:UInt32} DAY
        GROUP BY symbol
        ORDER BY symbol
        LIMIT {limit:UInt32}
      `,
      query_params: { days, limit },
      format: 'JSONEachRow',
    });
    return result.json();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting tracked symbols:`, error);
    return [];
  }
}

// Query functions for retrieving stored data
// Now reads from per-stock tables
export async function getStockHistory(symbol: string, days: number = 30) {
  try {
    const tableName = getStockQuotesTableName(symbol);
    
    // Check if table exists, if not try the old shared table
    let result;
    try {
      result = await clickhouseClient.query({
        query: `
          SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
          FROM ${tableName}
          WHERE timestamp >= now() - INTERVAL {days:UInt32} DAY
          ORDER BY timestamp DESC
        `,
        query_params: { days },
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      // If per-stock table doesn't exist, try old shared table for backward compatibility
      if (error?.message?.includes('does not exist') || error?.code === '60') {
        result = await clickhouseClient.query({
          query: `
            SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
            FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
            WHERE symbol = {symbol:String}
            AND timestamp >= now() - INTERVAL {days:UInt32} DAY
            ORDER BY timestamp DESC
          `,
          query_params: { symbol, days },
          format: 'JSONEachRow',
        });
      } else {
        throw error;
      }
    }

    const data = await result.json();
    // Add symbol to each record for compatibility
    return data.map((row: any) => ({ ...row, symbol }));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying stock history for ${symbol}:`, error);
    return [];
  }
}

// Get stock history by hours (for intraday data)
export async function getStockHistoryByHours(symbol: string, hours: number = 2, limit: number = 1000) {
  try {
    const tableName = getStockQuotesTableName(symbol);
    
    // Check if table exists, if not try the old shared table
    let result;
    try {
      result = await clickhouseClient.query({
        query: `
          SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
          FROM ${tableName}
          WHERE timestamp >= now() - INTERVAL {hours:UInt32} HOUR
          ORDER BY timestamp ASC
          LIMIT {limit:UInt32}
        `,
        query_params: { hours, limit },
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      // If per-stock table doesn't exist, try old shared table for backward compatibility
      if (error?.message?.includes('does not exist') || error?.code === '60') {
        result = await clickhouseClient.query({
          query: `
            SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
            FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
            WHERE symbol = {symbol:String}
            AND timestamp >= now() - INTERVAL {hours:UInt32} HOUR
            ORDER BY timestamp ASC
            LIMIT {limit:UInt32}
          `,
          query_params: { symbol, hours, limit },
          format: 'JSONEachRow',
        });
      } else {
        throw error;
      }
    }

    const data = await result.json();
    // Add symbol to each record for compatibility
    return data.map((row: any) => ({ ...row, symbol }));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying stock history by hours for ${symbol}:`, error);
    return [];
  }
}

export async function getLatestMarketMovers(type: 'gainers' | 'losers', limit: number = 20) {
  try {
    const result = await clickhouseClient.query({
      query: `
        /* Return the latest snapshot (single timestamp) to avoid mixing rows across multiple fetch cycles */
        WITH (
          SELECT max(timestamp)
          FROM ${CLICKHOUSE_CONFIG.database}.market_movers
          WHERE type = {type:String}
            AND timestamp >= toDateTime(today())
        ) AS latest_ts
        SELECT *
        FROM ${CLICKHOUSE_CONFIG.database}.market_movers
        WHERE type = {type:String}
          AND timestamp = latest_ts
        ORDER BY rank ASC
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

// Get market movers history (multiple snapshots)
export async function getMarketMoversHistory(type: 'gainers' | 'losers', limit: number = 100) {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT *
        FROM ${CLICKHOUSE_CONFIG.database}.market_movers
        WHERE type = {type:String}
        ORDER BY timestamp DESC, rank ASC
        LIMIT {limit:UInt32}
      `,
      query_params: { type, limit },
      format: 'JSONEachRow',
    });
    return result.json();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error querying market movers history (${type}):`, error);
    return [];
  }
}

// Store historical OHLCV data
// Now stores each stock in its own table
export async function storeHistoricalData(symbol: string, data: any[]) {
  try {
    if (!data || data.length === 0) return;

    // Validate and filter data
    const validData = validateData(data, validateHistoricalData, 'HistoricalData');
    if (validData.length === 0) {
      console.warn(`[${new Date().toISOString()}] No valid historical data to store for ${symbol}`);
      return;
    }

    await ensureHistoricalDataTable(symbol);

    const values = validData.map((item: any) => {
      const dateValue = item.date || item.time || item.timestamp;
      const dateObj = dateValue instanceof Date ? dateValue : new Date(dateValue);
      return {
        date: dateToClickHouseDate(dateObj),
        open: item.open || 0,
        high: item.high || 0,
        low: item.low || 0,
        close: item.close || 0,
        volume: item.volume || 0,
        adj_close: item.adjClose || item.close || 0,
      };
    });

    const result = await executeBatchInsert(
      getHistoricalDataTableName(symbol),
      values,
      { maxBatchSize: 1000, continueOnError: false },
      `historical data for ${symbol}`
    );

    if (result.success) {
      console.log(`[${new Date().toISOString()}] Successfully stored ${result.data} historical records for ${symbol}`);
    } else {
      console.error(`[${new Date().toISOString()}] Failed to store historical data for ${symbol}:`, result.error);
    }
  } catch (error: any) {
    // Log error instead of silently failing - helps diagnose issues
    const errorMsg = error?.message || String(error);
    const errorCode = (error as any)?.code;
    
    // Only silently fail if it's a connection issue
    if (isClickHouseConnectionError(errorMsg)) {
      console.warn(`[${new Date().toISOString()}] ClickHouse not available, skipping historical data storage for ${symbol}`);
      return;
    }
    
    // Log other errors for debugging
    console.error(`[${new Date().toISOString()}] Error storing historical data for ${symbol}:`, errorMsg, errorCode);
    throw error; // Re-throw to let caller know storage failed
  }
}

// Get historical data for a symbol
// Now reads from per-stock tables
export async function getHistoricalData(symbol: string, days: number = 30) {
  try {
    const tableName = getHistoricalDataTableName(symbol);
    
    // Check if table exists, if not try the old shared table
    let result;
    try {
      result = await clickhouseClient.query({
        query: `
          SELECT date, open, high, low, close, volume, adj_close
          FROM ${tableName}
          WHERE date >= today() - INTERVAL {days:UInt32} DAY
          ORDER BY date ASC
        `,
        query_params: { days },
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      // If per-stock table doesn't exist, try old shared table for backward compatibility
      if (error?.message?.includes('does not exist') || error?.code === '60') {
        result = await clickhouseClient.query({
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
      } else {
        throw error;
      }
    }

    const data = await result.json();
    console.log(`[${new Date().toISOString()}] Retrieved ${data.length} historical records for ${symbol} from ClickHouse`);
    return data;
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    const errorCode = (error as any)?.code;
    
    // Log detailed error information
    if (isClickHouseTableNotFoundError(error)) {
      console.warn(`[${new Date().toISOString()}] Historical data table for ${symbol} does not exist yet. No data available.`);
    } else if (isClickHouseConnectionError(errorMsg)) {
      console.warn(`[${new Date().toISOString()}] ClickHouse not available, cannot retrieve historical data for ${symbol}`);
    } else {
      console.error(`[${new Date().toISOString()}] Error querying historical data for ${symbol}:`, errorMsg, errorCode);
    }
    return [];
  }
}

// Store trending symbols
export async function storeTrendingSymbols(symbols: any[]) {
  // Validate and filter data
  const validSymbols = validateData(symbols, validateTrendingSymbols, 'TrendingSymbols');
  if (validSymbols.length === 0) {
    console.warn(`[${new Date().toISOString()}] No valid trending symbols to store`);
    return;
  }

  try {
    if (!symbols || symbols.length === 0) return;

    const timestamp = new Date(); // single snapshot timestamp
    const timestampStr = dateToClickHouseDateTime(timestamp);
    const values = validSymbols.map((item: any, index: number) => ({
      timestamp: timestampStr,
      symbol: item.symbol,
      name: item.shortName || item.longName || item.symbol,
      rank: index + 1,
    }));

    const result = await executeBatchInsert(
      `${CLICKHOUSE_CONFIG.database}.trending_symbols`,
      values,
      { maxBatchSize: 1000, continueOnError: false },
      'trending symbols'
    );

    if (result.success) {
      console.log(`[${new Date().toISOString()}] Successfully stored ${result.data} trending symbols`);
    } else {
      console.error(`[${new Date().toISOString()}] Failed to store trending symbols:`, result.error);
    }
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
        /* Return the latest snapshot (single timestamp) */
        WITH (
          SELECT max(timestamp)
          FROM ${CLICKHOUSE_CONFIG.database}.trending_symbols
          WHERE timestamp >= now() - INTERVAL 1 HOUR
        ) AS latest_ts
        SELECT symbol, name, rank
        FROM ${CLICKHOUSE_CONFIG.database}.trending_symbols
        WHERE timestamp = latest_ts
        ORDER BY rank ASC
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
// Now reads from per-stock tables
export async function getLatestStockQuote(symbol: string) {
  try {
    const tableName = getStockQuotesTableName(symbol);
    
    // Check if table exists, if not try the old shared table
    let result;
    try {
      // Try with day_open first
      result = await clickhouseClient.query({
        query: `
          SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, day_open, previous_close, currency
          FROM ${tableName}
          ORDER BY timestamp DESC
          LIMIT 1
        `,
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      // If error is about day_open column missing, try without it
      if (error?.message?.includes('day_open') || error?.code === '47') {
        try {
          result = await clickhouseClient.query({
            query: `
              SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, previous_close, currency
              FROM ${tableName}
              ORDER BY timestamp DESC
              LIMIT 1
            `,
            format: 'JSONEachRow',
          });
          // Read the result immediately and add day_open
          const data: any = await result.json();
          if (data.length > 0) {
            data[0].day_open = 0;
            return { ...data[0], symbol }; // Return early to avoid reading stream again
          }
          return null;
        } catch (fallbackError: any) {
          // If per-stock table doesn't exist, try old shared table
          if (fallbackError?.message?.includes('does not exist') || fallbackError?.code === '60') {
            result = await clickhouseClient.query({
              query: `
                SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, day_open, previous_close, currency
                FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
                WHERE symbol = {symbol:String}
                ORDER BY timestamp DESC
                LIMIT 1
              `,
              query_params: { symbol },
              format: 'JSONEachRow',
            });
          } else {
            throw fallbackError;
          }
        }
      } else if (error?.message?.includes('does not exist') || error?.code === '60') {
        // If per-stock table doesn't exist, try old shared table for backward compatibility
        result = await clickhouseClient.query({
          query: `
            SELECT timestamp, price, change, change_percent, volume, market_cap, pe_ratio, day_high, day_low, day_open, previous_close, currency
            FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes
            WHERE symbol = {symbol:String}
            ORDER BY timestamp DESC
            LIMIT 1
          `,
          query_params: { symbol },
          format: 'JSONEachRow',
        });
      } else {
        throw error;
      }
    }

    // Read the result stream only once
    const data: any = await result.json();
    if (data.length > 0) {
      return { ...data[0], symbol }; // Add symbol for compatibility
    }
    return null;
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

// Get the date range of existing historical data for a symbol
// Now reads from per-stock tables
export async function getHistoricalDataRange(symbol: string): Promise<{ minDate: Date | null; maxDate: Date | null; count: number }> {
  try {
    const tableName = getHistoricalDataTableName(symbol);
    
    // Check if table exists, if not try the old shared table
    let result;
    try {
      result = await clickhouseClient.query({
        query: `
          SELECT 
            min(date) as min_date,
            max(date) as max_date,
            count() as count
          FROM ${tableName}
        `,
        format: 'JSONEachRow',
      });
    } catch (error: any) {
      // If per-stock table doesn't exist, try old shared table for backward compatibility
      if (error?.message?.includes('does not exist') || error?.code === '60') {
        result = await clickhouseClient.query({
          query: `
            SELECT 
              min(date) as min_date,
              max(date) as max_date,
              count() as count
            FROM ${CLICKHOUSE_CONFIG.database}.historical_data
            WHERE symbol = {symbol:String}
          `,
          query_params: { symbol },
          format: 'JSONEachRow',
        });
      } else {
        throw error;
      }
    }

    const data: any = await result.json();
    if (data.length > 0 && data[0].count > 0) {
      return {
        minDate: new Date(data[0].min_date),
        maxDate: new Date(data[0].max_date),
        count: Number(data[0].count)
      };
    }
    return { minDate: null, maxDate: null, count: 0 };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error checking historical data range for ${symbol}:`, error);
    return { minDate: null, maxDate: null, count: 0 };
  }
}

// Get all unique symbols from market movers
export async function getAllTrackedSymbols(): Promise<string[]> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT symbol
        FROM ${CLICKHOUSE_CONFIG.database}.tracked_symbols FINAL
        WHERE last_seen >= now() - INTERVAL 7 DAY
        GROUP BY symbol
        ORDER BY symbol
      `,
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.map((row: any) => row.symbol);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting tracked symbols:`, error);
    return [];
  }
}

// Get symbols that need historical data backfill
// Updated to check per-stock tables
export async function getSymbolsNeedingBackfill(targetDays: number = 365): Promise<string[]> {
  try {
    // Get tracked symbols
    const trackedResult = await clickhouseClient.query({
      query: `
        SELECT symbol
        FROM ${CLICKHOUSE_CONFIG.database}.tracked_symbols
        WHERE last_seen >= now() - INTERVAL 7 DAY
        GROUP BY symbol
        ORDER BY symbol
      `,
      format: 'JSONEachRow',
    });
    
    const trackedData: any = await trackedResult.json();
    const trackedSymbols = trackedData.map((row: any) => row.symbol);
    
    if (trackedSymbols.length === 0) {
      return [];
    }

    // Check each symbol's per-stock table or fall back to shared table
    const symbolsNeedingBackfill: string[] = [];
    const minRecords = Math.floor(targetDays * 0.7);
    
    for (const symbol of trackedSymbols) {
      try {
        const tableName = getHistoricalDataTableName(symbol);
        let result;
        
        try {
          // Try per-stock table first
          result = await clickhouseClient.query({
            query: `
              SELECT 
                min(date) as min_date,
                max(date) as max_date,
                count() as record_count
              FROM ${tableName}
            `,
            format: 'JSONEachRow',
          });
        } catch (error: any) {
          // If per-stock table doesn't exist, try old shared table
          if (error?.message?.includes('does not exist') || error?.code === '60') {
            result = await clickhouseClient.query({
              query: `
                SELECT 
                  min(date) as min_date,
                  max(date) as max_date,
                  count() as record_count
                FROM ${CLICKHOUSE_CONFIG.database}.historical_data
                WHERE symbol = {symbol:String}
              `,
              query_params: { symbol },
              format: 'JSONEachRow',
            });
          } else {
            throw error;
          }
        }
        
        const data: any = await result.json();
        const recordCount = data.length > 0 ? Number(data[0].record_count || 0) : 0;
        const minDate = data.length > 0 && data[0].min_date ? new Date(data[0].min_date) : null;
        
        const needsBackfill = 
          recordCount === 0 ||
          recordCount < minRecords ||
          (minDate && minDate > new Date(Date.now() - targetDays * 24 * 60 * 60 * 1000));
        
        if (needsBackfill) {
          symbolsNeedingBackfill.push(symbol);
        }
      } catch (error) {
        // If we can't check, assume it needs backfill
        symbolsNeedingBackfill.push(symbol);
      }
    }
    
    return symbolsNeedingBackfill;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting symbols needing backfill:`, error);
    return [];
  }
}

// Script execution logging functions
export interface ScriptExecutionLog {
  script_name: string;
  status: 'success' | 'failed' | 'running';
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;
  rows_affected?: number;
  error_message?: string;
  metadata?: Record<string, any>;
}

// Start logging a script execution
export async function logScriptStart(scriptName: string, metadata?: Record<string, any>): Promise<string | null> {
  // Validate input
  if (!scriptName || typeof scriptName !== 'string') {
    console.warn(`[${new Date().toISOString()}] Invalid script name for logging:`, scriptName);
    return null;
  }

  try {
    const startedAt = new Date();
    const logEntry = {
      script_name: scriptName,
      status: 'running',
      started_at: dateToClickHouseDateTime(startedAt),
      metadata: metadata ? JSON.stringify(metadata) : null,
    };

    // Use bulk collector for script logging to batch multiple log entries
    bulkCollector.add(`${CLICKHOUSE_CONFIG.database}.script_execution_log`, logEntry, 10);

    // Return a unique identifier (we'll use started_at as identifier)
    return startedAt.toISOString();

    // Return a unique identifier (we'll use started_at as identifier)
    return startedAt.toISOString();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error logging script start for ${scriptName}:`, error);
    return null;
  }
}

// Update script execution log with completion status
// Using ReplacingMergeTree, inserting with same script_name and started_at will replace the record
export async function logScriptEnd(
  scriptName: string,
  startedAt: Date,
  status: 'success' | 'failed',
  rowsAffected?: number,
  errorMessage?: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Sanitize metadata to ensure all values are JSON-serializable
    let metadataString: string | null = null;
    if (metadata) {
      try {
        // Convert any Date objects or other non-serializable values to strings
        const sanitizedMetadata: Record<string, any> = {};
        for (const [key, value] of Object.entries(metadata)) {
          if (value instanceof Date) {
            sanitizedMetadata[key] = value.toISOString();
          } else if (value === undefined) {
            sanitizedMetadata[key] = null;
          } else {
            sanitizedMetadata[key] = value;
          }
        }
        metadataString = JSON.stringify(sanitizedMetadata);
      } catch (err) {
        // If metadata can't be stringified, use a simple string representation
        metadataString = JSON.stringify({ error: 'Failed to serialize metadata' });
      }
    }

    // Insert completion record - ReplacingMergeTree will replace the 'running' record
    // Use bulk collector for script logging to batch multiple log entries
    bulkCollector.add(`${CLICKHOUSE_CONFIG.database}.script_execution_log`, {
      script_name: scriptName,
      status,
      started_at: dateToClickHouseDateTime(startedAt),
      completed_at: dateToClickHouseDateTime(completedAt),
      duration_ms: durationMs,
      rows_affected: rowsAffected || null,
      error_message: errorMessage || null,
      metadata: metadataString,
    }, 10);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error logging script end for ${scriptName}:`, error);
  }
}

// Get script execution history
export async function getScriptExecutionHistory(
  scriptName?: string,
  limit: number = 50
): Promise<ScriptExecutionLog[]> {
  try {
    let query = `
      SELECT 
        script_name,
        status,
        started_at,
        completed_at,
        duration_ms,
        rows_affected,
        error_message,
        metadata
      FROM ${CLICKHOUSE_CONFIG.database}.script_execution_log
    `;

    const queryParams: any = { limit };

    if (scriptName) {
      query += ` WHERE script_name = {script_name:String}`;
      queryParams.script_name = scriptName;
    }

    query += ` ORDER BY started_at DESC LIMIT {limit:UInt32}`;

    const result = await clickhouseClient.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.map((row: any) => ({
      script_name: row.script_name,
      status: row.status,
      started_at: new Date(row.started_at),
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      duration_ms: row.duration_ms ? Number(row.duration_ms) : undefined,
      rows_affected: row.rows_affected ? Number(row.rows_affected) : undefined,
      error_message: row.error_message || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting script execution history:`, error);
    return [];
  }
}

// Get latest script execution status
export async function getLatestScriptExecution(scriptName: string): Promise<ScriptExecutionLog | null> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT 
          script_name,
          status,
          started_at,
          completed_at,
          duration_ms,
          rows_affected,
          error_message,
          metadata
        FROM ${CLICKHOUSE_CONFIG.database}.script_execution_log
        WHERE script_name = {script_name:String}
        ORDER BY started_at DESC
        LIMIT 1
      `,
      query_params: { script_name: scriptName },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    if (data.length === 0) return null;

    const row = data[0];
    return {
      script_name: row.script_name,
      status: row.status,
      started_at: new Date(row.started_at),
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      duration_ms: row.duration_ms ? Number(row.duration_ms) : undefined,
      rows_affected: row.rows_affected ? Number(row.rows_affected) : undefined,
      error_message: row.error_message || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting latest script execution for ${scriptName}:`, error);
    return null;
  }
}

// Technical Indicators functions

export interface TechnicalIndicatorData {
  date: Date;
  symbol: string;
  rsi: number;
  macdValue: number;
  macdSignal: number;
  macdHistogram: number;
  volatility: number;
  volatilityPercent: number;
  dataPoints: number;
}

// Store technical indicators
export async function storeTechnicalIndicators(indicators: TechnicalIndicatorData[]): Promise<void> {
  try {
    if (!indicators || indicators.length === 0) return;

    // Additional validation for technical indicators
    const validIndicators = indicators.filter(indicator => {
      if (!validateHistoricalData({date: indicator.date, open: 1, high: 1, low: 1, close: 1, volume: 1})) {
        console.warn(`[${new Date().toISOString()}] Invalid technical indicator date:`, indicator);
        return false;
      }
      // Validate numeric fields
      const numericFields = ['rsi', 'macdValue', 'macdSignal', 'macdHistogram', 'volatility', 'volatilityPercent'];
      for (const field of numericFields) {
        if (typeof (indicator as any)[field] !== 'number' || isNaN((indicator as any)[field])) {
          console.warn(`[${new Date().toISOString()}] Invalid technical indicator ${field}:`, indicator);
          return false;
        }
      }
      return true;
    });

    if (validIndicators.length === 0) {
      console.warn(`[${new Date().toISOString()}] No valid technical indicators to store`);
      return;
    }

    const values = validIndicators.map((indicator) => ({
      date: dateToClickHouseDate(indicator.date instanceof Date ? indicator.date : new Date(indicator.date)),
      symbol: indicator.symbol,
      rsi: indicator.rsi,
      macd_value: indicator.macdValue,
      macd_signal: indicator.macdSignal,
      macd_histogram: indicator.macdHistogram,
      volatility: indicator.volatility,
      volatility_percent: indicator.volatilityPercent,
      data_points: indicator.dataPoints,
    }));

    const result = await executeBatchInsert(
      `${CLICKHOUSE_CONFIG.database}.technical_indicators`,
      values,
      { maxBatchSize: 1000, continueOnError: false },
      'technical indicators'
    );

    if (result.success) {
      console.log(`[${new Date().toISOString()}] Successfully stored ${result.data} technical indicator records`);
    } else {
      console.error(`[${new Date().toISOString()}] Failed to store technical indicators:`, result.error);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error storing technical indicators:`, error);
    // Don't throw - allow script to continue
  }
}

// Get latest technical indicators for a symbol
export async function getLatestTechnicalIndicators(symbol: string): Promise<TechnicalIndicatorData | null> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT 
          date,
          symbol,
          rsi,
          macd_value,
          macd_signal,
          macd_histogram,
          volatility,
          volatility_percent,
          data_points
        FROM ${CLICKHOUSE_CONFIG.database}.technical_indicators
        WHERE symbol = {symbol:String}
        ORDER BY date DESC
        LIMIT 1
      `,
      query_params: { symbol },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    if (data.length === 0) return null;

    const row = data[0];
    return {
      date: new Date(row.date),
      symbol: row.symbol,
      rsi: Number(row.rsi),
      macdValue: Number(row.macd_value),
      macdSignal: Number(row.macd_signal),
      macdHistogram: Number(row.macd_histogram),
      volatility: Number(row.volatility),
      volatilityPercent: Number(row.volatility_percent),
      dataPoints: Number(row.data_points),
    };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting latest technical indicators for ${symbol}:`, error);
    return null;
  }
}

// Get technical indicators history for a symbol
export async function getTechnicalIndicatorsHistory(
  symbol: string,
  days: number = 30
): Promise<TechnicalIndicatorData[]> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT 
          date,
          symbol,
          rsi,
          macd_value,
          macd_signal,
          macd_histogram,
          volatility,
          volatility_percent,
          data_points
        FROM ${CLICKHOUSE_CONFIG.database}.technical_indicators
        WHERE symbol = {symbol:String}
        AND date >= today() - INTERVAL {days:UInt32} DAY
        ORDER BY date DESC
      `,
      query_params: { symbol, days },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.map((row: any) => ({
      date: new Date(row.date),
      symbol: row.symbol,
      rsi: Number(row.rsi),
      macdValue: Number(row.macd_value),
      macdSignal: Number(row.macd_signal),
      macdHistogram: Number(row.macd_histogram),
      volatility: Number(row.volatility),
      volatilityPercent: Number(row.volatility_percent),
      dataPoints: Number(row.data_points),
    }));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting technical indicators history for ${symbol}:`, error);
    return [];
  }
}

// Check if indicators are fresh for a symbol (within last day)
export async function hasFreshIndicators(symbol: string, maxAgeHours: number = 24): Promise<boolean> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT count() as count
        FROM ${CLICKHOUSE_CONFIG.database}.technical_indicators
        WHERE symbol = {symbol:String}
        AND date = today()
        AND calculated_at >= now() - INTERVAL {hours:UInt32} HOUR
      `,
      query_params: { symbol, hours: maxAgeHours },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.length > 0 && data[0].count > 0;
  } catch (error) {
    return false;
  }
}

// AI Strategy and Trading Functions

export interface AIStrategyResult {
  timestamp: Date;
  symbol: string;
  strategy: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  price: number;
  technicalIndicators?: {
    rsi?: number;
    macd?: number;
    bollingerBands?: { upper: number; middle: number; lower: number };
    movingAverages?: { sma20: number; sma50: number; ema12: number; ema26: number };
  };
}

export interface AISignal {
  signalId: string;
  timestamp: Date;
  symbol: string;
  strategy: string;
  action: 'BUY' | 'SELL';
  confidence: number;
  reason: string;
  price: number;
  status: 'pending' | 'executed' | 'cancelled';
  executedAt?: Date;
  tradeId?: string;
}

export interface Trade {
  tradeId: string;
  signalId: string | null;
  timestamp: Date;
  symbol: string;
  action: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number;
  quantity: number;
  investmentAmount: number;
  confidence: number;
  exitPrice?: number;
  exitTimestamp?: Date;
  profitLoss?: number;
  profitLossPercent?: number;
  status: 'open' | 'closed' | 'cancelled';
  reason: string;
}

// Store AI strategy result
export async function storeAIStrategyResult(result: AIStrategyResult): Promise<void> {
  // Validate data
  if (!validateAIStrategyResults(result)) {
    console.warn(`[${new Date().toISOString()}] Invalid AI strategy result:`, result);
    return;
  }

  try {
    const indicators = result.technicalIndicators || {};
    const bb = indicators.bollingerBands;
    const ma = indicators.movingAverages;

    // Use bulk collector for AI strategy results to batch multiple analyses
    bulkCollector.add(`${CLICKHOUSE_CONFIG.database}.ai_strategy_results`, {
      timestamp: dateToClickHouseDateTime(result.timestamp),
      symbol: result.symbol,
      strategy: result.strategy,
      action: result.action,
      confidence: result.confidence,
      reason: result.reason,
      price: result.price,
      rsi: indicators.rsi || null,
      macd: indicators.macd || null,
      bb_upper: bb?.upper || null,
      bb_middle: bb?.middle || null,
      bb_lower: bb?.lower || null,
      sma20: ma?.sma20 || null,
      sma50: ma?.sma50 || null,
      ema12: ma?.ema12 || null,
      ema26: ma?.ema26 || null,
    }, 20);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error storing AI strategy result:`, error);
  }
}

// Store AI signal (high confidence > 75%)
export async function storeAISignal(signal: AISignal): Promise<void> {
  // Basic validation - AISignal interface should be properly typed
  if (!signal || typeof signal !== 'object') {
    console.warn(`[${new Date().toISOString()}] Invalid AI signal data:`, signal);
    return;
  }

  // Validate required fields
  if (!signal.signalId || !signal.symbol || !signal.strategy || !signal.action) {
    console.warn(`[${new Date().toISOString()}] Missing required AI signal fields:`, signal);
    return;
  }

  if (typeof signal.confidence !== 'number' || signal.confidence < 0 || signal.confidence > 1) {
    console.warn(`[${new Date().toISOString()}] Invalid AI signal confidence:`, signal);
    return;
  }

  try {
    // Use bulk collector for AI signals to batch multiple signals
    bulkCollector.add(`${CLICKHOUSE_CONFIG.database}.ai_signals`, {
      signal_id: signal.signalId,
      timestamp: dateToClickHouseDateTime(signal.timestamp),
      symbol: signal.symbol,
      strategy: signal.strategy,
      action: signal.action,
      confidence: signal.confidence,
      reason: signal.reason,
      price: signal.price,
      status: signal.status,
      executed_at: signal.executedAt ? dateToClickHouseDateTime(signal.executedAt) : null,
      trade_id: signal.tradeId || null,
      updated_at: dateToClickHouseDateTime(signal.executedAt || signal.timestamp), // Use executed_at if available, otherwise timestamp
    }, 25);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error storing AI signal:`, error);
  }
}

// Store trade history
export async function storeTrade(trade: Trade): Promise<void> {
  // Validate trade data
  if (!validateTradeHistory(trade)) {
    console.warn(`[${new Date().toISOString()}] Invalid trade data:`, trade);
    return;
  }

  try {
    // Use bulk collector for trades to batch multiple trade records
    bulkCollector.add(`${CLICKHOUSE_CONFIG.database}.trade_history`, {
      trade_id: trade.tradeId,
      signal_id: trade.signalId,
      timestamp: dateToClickHouseDateTime(trade.timestamp),
      symbol: trade.symbol,
      action: trade.action,
      strategy: trade.strategy,
      entry_price: trade.entryPrice,
      quantity: trade.quantity,
      investment_amount: trade.investmentAmount,
      confidence: trade.confidence,
      exit_price: trade.exitPrice || null,
      exit_timestamp: trade.exitTimestamp ? dateToClickHouseDateTime(trade.exitTimestamp) : null,
      profit_loss: trade.profitLoss || null,
      profit_loss_percent: trade.profitLossPercent || null,
      status: trade.status,
      reason: trade.reason,
      updated_at: dateToClickHouseDateTime(trade.exitTimestamp || trade.timestamp), // Use exit_timestamp if available, otherwise timestamp
    }, 15);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error storing trade:`, error);
  }
}

// Get pending AI signals
export async function getPendingAISignals(limit: number = 100): Promise<AISignal[]> {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT 
          signal_id,
          timestamp,
          symbol,
          strategy,
          action,
          confidence,
          reason,
          price,
          status,
          executed_at,
          trade_id
        FROM ${CLICKHOUSE_CONFIG.database}.ai_signals
        WHERE status = 'pending'
        ORDER BY confidence DESC, timestamp DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { limit },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.map((row: any) => ({
      signalId: row.signal_id,
      timestamp: new Date(row.timestamp),
      symbol: row.symbol,
      strategy: row.strategy,
      action: row.action,
      confidence: Number(row.confidence),
      reason: row.reason,
      price: Number(row.price),
      status: row.status,
      executedAt: row.executed_at ? new Date(row.executed_at) : undefined,
      tradeId: row.trade_id || undefined,
    }));
  } catch (error: any) {
    // If table doesn't exist, return empty array (tables will be created on server restart)
    if (isClickHouseTableNotFoundError(error)) {
      console.warn(`[${new Date().toISOString()}] AI signals table does not exist yet. Tables will be created on server restart.`);
      return [];
    }
    console.error(`[${new Date().toISOString()}] Error getting pending AI signals:`, error);
    return [];
  }
}

// Get open trades
export async function getOpenTrades(symbol?: string): Promise<Trade[]> {
  try {
    let query = `
      SELECT 
        trade_id,
        signal_id,
        timestamp,
        symbol,
        action,
        strategy,
        entry_price,
        quantity,
        investment_amount,
        confidence,
        exit_price,
        exit_timestamp,
        profit_loss,
        profit_loss_percent,
        status,
        reason
      FROM ${CLICKHOUSE_CONFIG.database}.trade_history
      WHERE status = 'open'
    `;
    
    const queryParams: any = {};
    if (symbol) {
      query += ` AND symbol = {symbol:String}`;
      queryParams.symbol = symbol;
    }
    
    query += ` ORDER BY timestamp DESC`;

    const result = await clickhouseClient.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
    });

    const data: any = await result.json();
    return data.map((row: any) => ({
      tradeId: row.trade_id,
      signalId: row.signal_id,
      timestamp: new Date(row.timestamp),
      symbol: row.symbol,
      action: row.action,
      strategy: row.strategy,
      entryPrice: Number(row.entry_price),
      quantity: Number(row.quantity),
      investmentAmount: Number(row.investment_amount),
      confidence: Number(row.confidence),
      exitPrice: row.exit_price ? Number(row.exit_price) : undefined,
      exitTimestamp: row.exit_timestamp ? new Date(row.exit_timestamp) : undefined,
      profitLoss: row.profit_loss ? Number(row.profit_loss) : undefined,
      profitLossPercent: row.profit_loss_percent ? Number(row.profit_loss_percent) : undefined,
      status: row.status,
      reason: row.reason,
    }));
  } catch (error: any) {
    // If table doesn't exist, return empty array (tables will be created on server restart)
    if (isClickHouseTableNotFoundError(error)) {
      console.warn(`[${new Date().toISOString()}] Trade history table does not exist yet. Tables will be created on server restart.`);
      return [];
    }
    console.error(`[${new Date().toISOString()}] Error getting open trades:`, error);
    return [];
  }
}

// =============================================================================
// ADVANCED BATCH OPERATIONS COORDINATOR
// =============================================================================

/**
 * Advanced batch operations coordinator - combine multiple data types into optimized batches
 */
export async function executeAdvancedBatchOperations(
  operations: {
    stockQuotes?: any[];
    marketMovers?: any[];
    trendingSymbols?: any[];
    historicalData?: { symbol: string; data: any[] }[];
    technicalIndicators?: any[];
    aiSignals?: any[];
    trades?: any[];
  },
  options: {
    parallelExecution?: boolean;
    prioritizeByTable?: boolean;
    maxConcurrentBatches?: number;
  } = {}
): Promise<DatabaseOperationResult<{ [operation: string]: number }>> {
  const {
    parallelExecution = true,
    prioritizeByTable = true,
    maxConcurrentBatches = 5
  } = options;

  const results: { [operation: string]: number } = {};
  const batchPromises: Promise<DatabaseOperationResult<any>>[] = [];

  // Stock quotes - highest priority, processed individually per symbol
  if (operations.stockQuotes && operations.stockQuotes.length > 0) {
    batchPromises.push(
      (async () => {
        const result = await storeStockQuotes(operations.stockQuotes!, new Date());
        return {
          success: true, // storeStockQuotes handles its own success/failure internally
          data: operations.stockQuotes!.length
        };
      })()
    );
  }

  // Combined market data batch
  if (operations.marketMovers || operations.trendingSymbols) {
    batchPromises.push(
      insertMarketDataBatch(
        operations.marketMovers,
        operations.trendingSymbols
      )
    );
  }

  // Historical data - can be parallelized
  if (operations.historicalData && operations.historicalData.length > 0) {
    if (parallelExecution) {
      // Execute in parallel with concurrency limit
      const chunks = [];
      for (let i = 0; i < operations.historicalData.length; i += maxConcurrentBatches) {
        chunks.push(operations.historicalData.slice(i, i + maxConcurrentBatches));
      }

      for (const chunk of chunks) {
        const chunkPromises = chunk.map(async (item) => {
          const result = await storeHistoricalData(item.symbol, item.data);
          return {
            symbol: item.symbol,
            success: true,
            count: item.data.length
          };
        });

        batchPromises.push(
          Promise.all(chunkPromises).then(chunkResults => ({
            success: true,
            data: chunkResults.reduce((acc, r) => ({ ...acc, [r.symbol]: r.count }), {})
          }))
        );
      }
    } else {
      // Sequential execution
      for (const item of operations.historicalData) {
        batchPromises.push(
          (async () => {
            await storeHistoricalData(item.symbol, item.data);
            return {
              success: true,
              data: { [item.symbol]: item.data.length }
            };
          })()
        );
      }
    }
  }

  // Technical indicators - batch insert
  if (operations.technicalIndicators && operations.technicalIndicators.length > 0) {
    batchPromises.push(
      (async () => {
        const result = await storeTechnicalIndicators(operations.technicalIndicators!);
        return {
          success: true,
          data: operations.technicalIndicators!.length
        };
      })()
    );
  }

  // AI signals and trades go to bulk collector automatically
  if (operations.aiSignals && operations.aiSignals.length > 0) {
    operations.aiSignals.forEach(signal => {
      bulkCollector.add(`${CLICKHOUSE_CONFIG.database}.ai_signals`, signal, 25);
    });
  }

  if (operations.trades && operations.trades.length > 0) {
    operations.trades.forEach(trade => {
      bulkCollector.add(`${CLICKHOUSE_CONFIG.database}.trade_history`, trade, 15);
    });
  }

  // Execute all batches
  const batchResults = await Promise.allSettled(batchPromises);

  for (let i = 0; i < batchResults.length; i++) {
    const result = batchResults[i];
    if (result.status === 'fulfilled') {
      Object.assign(results, result.value.data || {});
    } else {
      console.error(`[${new Date().toISOString()}] Advanced batch operation ${i} failed:`, result.reason);
    }
  }

  // Force flush bulk operations immediately
  await bulkCollector.flushAll();

  return {
    success: true,
    data: results
  };
}