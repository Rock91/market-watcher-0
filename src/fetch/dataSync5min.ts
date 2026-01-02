import { insertMany } from '../compute/batchWriter';
import { log } from '../utils/logger';
import { getTrackedSymbols } from '../../server/services/clickhouse';
import { getStockQuote } from '../../server/services/yahooFinance';
import { CLICKHOUSE_CONFIG } from '../../server/config/database';
import { retryWithBackoff, sleep } from '../utils/rateLimiter';

/**
 * Fetch latest 5-minute market data for all tracked symbols
 * Note: Yahoo Finance doesn't support 5-minute intervals directly,
 * so we fetch current quotes and store them with 5-minute timestamps
 */
export const dataSync5min = async () => {
    log('Starting 5-min market data sync...');
    
    try {
        // Get all tracked symbols
        const trackedSymbols = await getTrackedSymbols(7, 1000);
        log(`Found ${trackedSymbols.length} tracked symbols for 5-min sync`);

        const rows: any[] = [];
        let successCount = 0;
        let errorCount = 0;

        // Add initial delay to stagger parallel requests
        await sleep(2000);

        // Fetch current quotes for all symbols (simulating 5-min data)
        for (const { symbol } of trackedSymbols) {
            try {
                const quote = await retryWithBackoff(
                    () => getStockQuote(symbol),
                    3,
                    2000
                );
                
                // Round timestamp to nearest 5 minutes
                const now = new Date();
                const roundedMinutes = Math.floor(now.getMinutes() / 5) * 5;
                const timestamp = new Date(now);
                timestamp.setMinutes(roundedMinutes, 0, 0);

                rows.push({
                    timestamp,
                    symbol: quote.symbol,
                    strategy: '5min_sync',
                    action: 'HOLD',
                    confidence: 0,
                    reason: '5-minute market data snapshot',
                    price: quote.price,
                    rsi: null,
                    macd: null,
                    bb_upper: null,
                    bb_middle: null,
                    bb_lower: null,
                    sma20: null,
                    sma50: null,
                    ema12: null,
                    ema26: null,
                });

                successCount++;

                // Delay between requests to avoid rate limiting
                await sleep(200);
            } catch (error: any) {
                errorCount++;
                log(`Error fetching 5-min data for ${symbol}: ${error.message}`);
            }
        }

        // Batch insert all 5-min data
        if (rows.length > 0) {
            await insertMany(rows, `${CLICKHOUSE_CONFIG.database}.ai_strategy_results`);
            log(`5-min data sync: ${successCount} symbols successful, ${errorCount} errors, ${rows.length} rows queued`);
        } else {
            log('No 5-min data rows to insert');
        }
    } catch (error: any) {
        log(`5-min data sync failed: ${error.message}`);
        throw error;
    }

    log('5-min market data sync completed.');
};

