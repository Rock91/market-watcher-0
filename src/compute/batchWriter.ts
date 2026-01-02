import { clickhouseClient, CLICKHOUSE_CONFIG } from '../../server/database/client';
import { log } from '../utils/logger';

const BATCH_SIZE = 1000;
const buffers: Map<string, any[]> = new Map();

/**
 * Convert Date to ClickHouse DateTime string format
 */
function dateToClickHouseDateTime(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
}

/**
 * Insert rows into buffer for batch processing
 */
export const insertMany = async (rows: any[], tableName: string) => {
    if (!buffers.has(tableName)) {
        buffers.set(tableName, []);
    }
    
    const buffer = buffers.get(tableName)!;
    
    // Convert Date objects to strings for ClickHouse
    const processedRows = rows.map(row => {
        const processed: any = {};
        for (const [key, value] of Object.entries(row)) {
            if (value instanceof Date) {
                processed[key] = dateToClickHouseDateTime(value);
            } else {
                processed[key] = value;
            }
        }
        return processed;
    });
    
    buffer.push(...processedRows);

    if (buffer.length >= BATCH_SIZE) {
        await flush(tableName);
    }
};

/**
 * Flush all pending rows to ClickHouse (WSL-safe bulk insert)
 */
export const flush = async (tableName: string) => {
    const buffer = buffers.get(tableName);
    if (!buffer || buffer.length === 0) return;

    const rowsToInsert = buffer.splice(0, buffer.length);
    log(`Inserting ${rowsToInsert.length} rows into ${tableName}...`);

    try {
        // Use ClickHouse client's insert method for WSL-safe bulk inserts
        await clickhouseClient.insert({
            table: tableName,
            values: rowsToInsert,
            format: 'JSONEachRow',
        });

        log(`Successfully inserted ${rowsToInsert.length} rows into ${tableName}`);
    } catch (error: any) {
        log(`Error inserting into ${tableName}: ${error.message}`);
        // Re-add rows to buffer for retry (optional: implement retry logic)
        buffer.unshift(...rowsToInsert);
        throw error;
    }
};

/**
 * Flush all buffers for all tables
 */
export const flushAll = async () => {
    const tableNames = Array.from(buffers.keys());
    await Promise.all(tableNames.map(tableName => flush(tableName)));
};

