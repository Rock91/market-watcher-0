import { insertMany } from '../compute/batchWriter';
import { log } from '../utils/logger';
import { getTrackedSymbols } from '../../server/services/clickhouse';
import { getHistoricalData } from '../../server/services/yahooFinance';
import { CLICKHOUSE_CONFIG } from '../../server/config/database';
import { retryWithBackoff, sleep } from '../utils/rateLimiter';

/**
 * Fetch 30-day historical data for all tracked symbols
 */
export const historicalDataSync = async () => {
    log('Starting historical data sync...');
    
    try {
        // Get all tracked symbols from the last 30 days
        const trackedSymbols = await getTrackedSymbols(30, 1000);
        log(`Found ${trackedSymbols.length} tracked symbols for historical sync`);

        const rows: any[] = [];
        let successCount = 0;
        let errorCount = 0;

        // Add initial delay to stagger parallel requests
        await sleep(1000);

        // Fetch historical data for each symbol
        for (const { symbol } of trackedSymbols) {
            try {
                // Fetch 30 days of historical data with retry logic
                const endDate = new Date();
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - 30);

                const historicalData = await retryWithBackoff(
                    () => getHistoricalData(symbol, startDate, endDate, '1d'),
                    3,
                    2000
                );

                if (historicalData && Array.isArray(historicalData) && historicalData.length > 0) {
                    // Transform historical data to match ai_strategy_results table structure
                    for (const dataPoint of historicalData) {
                        const timestamp = dataPoint.date ? new Date(dataPoint.date) : new Date();
                        const price = dataPoint.close || dataPoint.adjClose || 0;

                        if (price > 0) {
                            rows.push({
                                timestamp,
                                symbol,
                                strategy: 'historical_sync',
                                action: 'HOLD',
                                confidence: 0,
                                reason: 'Historical data point',
                                price,
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
                        }
                    }
                    successCount++;
                }

                // Delay between requests to avoid rate limiting
                await sleep(300);
            } catch (error: any) {
                errorCount++;
                log(`Error fetching historical data for ${symbol}: ${error.message}`);
            }
        }

        // Batch insert all historical data
        if (rows.length > 0) {
            await insertMany(rows, `${CLICKHOUSE_CONFIG.database}.ai_strategy_results`);
            log(`Historical data sync: ${successCount} symbols successful, ${errorCount} errors, ${rows.length} rows queued`);
        } else {
            log('No historical data rows to insert');
        }
    } catch (error: any) {
        log(`Historical data sync failed: ${error.message}`);
        throw error;
    }

    log('Historical data sync completed.');
};

