import { insertMany } from './batchWriter';
import { log } from '../utils/logger';
import { clickhouseClient, CLICKHOUSE_CONFIG } from '../../server/database/client';
import { calculateRSI, calculateEMA, calculateMACD, calculateVolatility } from '../../server/services/technicalIndicators';

/**
 * Get the latest timestamp for which indicators have been calculated
 */
async function getLastIndicatorTimestamp(symbol: string): Promise<Date | null> {
    try {
        const result = await clickhouseClient.query({
            query: `
                SELECT max(date) as last_date
                FROM ${CLICKHOUSE_CONFIG.database}.technical_indicators
                WHERE symbol = {symbol:String}
            `,
            query_params: { symbol },
            format: 'JSONEachRow',
        });

        const rows = await result.json();
        if (rows.length > 0 && rows[0].last_date) {
            return new Date(rows[0].last_date);
        }
        return null;
    } catch (error) {
        // Table might not exist or no data yet
        return null;
    }
}

/**
 * Fetch new market data rows that don't have indicators yet
 */
async function getNewMarketData(symbol: string, lastTimestamp: Date | null): Promise<any[]> {
    try {
        let query = `
            SELECT 
                timestamp,
                symbol,
                price
            FROM ${CLICKHOUSE_CONFIG.database}.ai_strategy_results
            WHERE symbol = {symbol:String}
        `;

        const params: any = { symbol };

        if (lastTimestamp) {
            query += ` AND timestamp > {lastTimestamp:DateTime}`;
            params.lastTimestamp = lastTimestamp.toISOString().replace('T', ' ').substring(0, 19);
        }

        query += ` ORDER BY timestamp ASC LIMIT 1000`;

        const result = await clickhouseClient.query({
            query,
            query_params: params,
            format: 'JSONEachRow',
        });

        return await result.json();
    } catch (error: any) {
        log(`Error fetching new market data for ${symbol}: ${error.message}`);
        return [];
    }
}

/**
 * Get historical prices for a symbol to calculate indicators
 */
async function getHistoricalPrices(symbol: string, endDate: Date, days: number = 50): Promise<number[]> {
    try {
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - days);

        const result = await clickhouseClient.query({
            query: `
                SELECT price
                FROM ${CLICKHOUSE_CONFIG.database}.ai_strategy_results
                WHERE symbol = {symbol:String}
                  AND timestamp >= {startDate:DateTime}
                  AND timestamp <= {endDate:DateTime}
                  AND price > 0
                ORDER BY timestamp ASC
            `,
            query_params: {
                symbol,
                startDate: startDate.toISOString().replace('T', ' ').substring(0, 19),
                endDate: endDate.toISOString().replace('T', ' ').substring(0, 19),
            },
            format: 'JSONEachRow',
        });

        const rows = await result.json();
        return rows.map((row: any) => row.price).filter((price: number) => price > 0);
    } catch (error: any) {
        log(`Error fetching historical prices for ${symbol}: ${error.message}`);
        return [];
    }
}

/**
 * Calculate technical indicators for new data (incremental)
 */
export const technicalIndicatorsSync = async () => {
    log('Starting technical indicators calculation...');

    try {
        // Get all unique symbols from recent market data
        const symbolsResult = await clickhouseClient.query({
            query: `
                SELECT DISTINCT symbol
                FROM ${CLICKHOUSE_CONFIG.database}.ai_strategy_results
                WHERE timestamp >= now() - INTERVAL 7 DAY
                LIMIT 500
            `,
            format: 'JSONEachRow',
        });

        const symbols = await symbolsResult.json();
        log(`Calculating indicators for ${symbols.length} symbols`);

        const indicators: any[] = [];
        let processedCount = 0;
        let errorCount = 0;

        for (const { symbol } of symbols) {
            try {
                // Get last calculated timestamp for this symbol
                const lastTimestamp = await getLastIndicatorTimestamp(symbol);

                // Get new market data since last calculation
                const newData = await getNewMarketData(symbol, lastTimestamp);

                if (newData.length === 0) {
                    continue; // No new data for this symbol
                }

                // Group by date and calculate indicators for each unique date
                const dataByDate = new Map<string, any[]>();
                for (const row of newData) {
                    const date = new Date(row.timestamp);
                    const dateStr = date.toISOString().substring(0, 10); // YYYY-MM-DD
                    
                    if (!dataByDate.has(dateStr)) {
                        dataByDate.set(dateStr, []);
                    }
                    dataByDate.get(dateStr)!.push(row);
                }

                // Calculate indicators for each date
                for (const [dateStr, rows] of dataByDate.entries()) {
                    const date = new Date(dateStr);
                    const prices = rows.map((r: any) => r.price).filter((p: number) => p > 0);

                    if (prices.length === 0) continue;

                    // Get historical prices for proper indicator calculation
                    const historicalPrices = await getHistoricalPrices(symbol, date, 50);

                    if (historicalPrices.length < 14) {
                        // Not enough data for indicators
                        continue;
                    }

                    // Calculate indicators
                    const rsi = calculateRSI(historicalPrices, 14);
                    const macd = calculateMACD(historicalPrices);
                    const volatilityResult = calculateVolatility(historicalPrices, 20);
                    const ema12 = calculateEMA(historicalPrices, 12);
                    const ema26 = calculateEMA(historicalPrices, 26);

                    // Calculate SMA20 and SMA50
                    const sma20 = historicalPrices.length >= 20
                        ? historicalPrices.slice(-20).reduce((sum, p) => sum + p, 0) / 20
                        : historicalPrices.reduce((sum, p) => sum + p, 0) / historicalPrices.length;
                    
                    const sma50 = historicalPrices.length >= 50
                        ? historicalPrices.slice(-50).reduce((sum, p) => sum + p, 0) / 50
                        : sma20;

                    indicators.push({
                        date: dateStr,
                        symbol,
                        rsi,
                        macd_value: macd.macd,
                        macd_signal: macd.signal,
                        macd_histogram: macd.histogram,
                        volatility: volatilityResult.volatility,
                        volatility_percent: volatilityResult.volatilityPercent,
                        data_points: historicalPrices.length,
                        calculated_at: new Date(),
                    });
                }

                processedCount++;
            } catch (error: any) {
                errorCount++;
                log(`Error calculating indicators for ${symbol}: ${error.message}`);
            }
        }

        // Batch insert all indicators
        if (indicators.length > 0) {
            await insertMany(indicators, `${CLICKHOUSE_CONFIG.database}.technical_indicators`);
            log(`Technical indicators: ${processedCount} symbols processed, ${errorCount} errors, ${indicators.length} indicator rows queued`);
        } else {
            log('No new indicators to calculate');
        }
    } catch (error: any) {
        log(`Technical indicators calculation failed: ${error.message}`);
        throw error;
    }

    log('Technical indicators calculation completed.');
};

