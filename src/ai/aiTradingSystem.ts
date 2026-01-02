import { log } from '../utils/logger';
import { insertMany } from '../compute/batchWriter';
import { clickhouseClient, CLICKHOUSE_CONFIG } from '../../server/database/client';
import { generateAISignal, MarketData } from '../../server/services/ai-strategies';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get latest indicators for a symbol
 */
async function getLatestIndicators(symbol: string): Promise<any> {
    try {
        const result = await clickhouseClient.query({
            query: `
                SELECT 
                    rsi,
                    macd_value,
                    macd_signal,
                    macd_histogram,
                    volatility,
                    volatility_percent
                FROM ${CLICKHOUSE_CONFIG.database}.technical_indicators
                WHERE symbol = {symbol:String}
                ORDER BY date DESC
                LIMIT 1
            `,
            query_params: { symbol },
            format: 'JSONEachRow',
        });

        const rows = await result.json();
        return rows.length > 0 ? rows[0] : null;
    } catch (error: any) {
        log(`Error fetching indicators for ${symbol}: ${error.message}`);
        return null;
    }
}

/**
 * Get historical prices for a symbol
 */
async function getHistoricalPrices(symbol: string, limit: number = 50): Promise<number[]> {
    try {
        const result = await clickhouseClient.query({
            query: `
                SELECT price
                FROM ${CLICKHOUSE_CONFIG.database}.ai_strategy_results
                WHERE symbol = {symbol:String}
                  AND price > 0
                ORDER BY timestamp DESC
                LIMIT {limit:UInt32}
            `,
            query_params: { symbol, limit },
            format: 'JSONEachRow',
        });

        const rows = await result.json();
        return rows.map((row: any) => row.price).reverse(); // Reverse to get chronological order
    } catch (error: any) {
        log(`Error fetching historical prices for ${symbol}: ${error.message}`);
        return [];
    }
}

/**
 * Get latest market data for a symbol
 */
async function getLatestMarketData(symbol: string): Promise<any> {
    try {
        const result = await clickhouseClient.query({
            query: `
                SELECT 
                    timestamp,
                    symbol,
                    price
                FROM ${CLICKHOUSE_CONFIG.database}.ai_strategy_results
                WHERE symbol = {symbol:String}
                  AND price > 0
                ORDER BY timestamp DESC
                LIMIT 1
            `,
            query_params: { symbol },
            format: 'JSONEachRow',
        });

        const rows = await result.json();
        return rows.length > 0 ? rows[0] : null;
    } catch (error: any) {
        log(`Error fetching latest market data for ${symbol}: ${error.message}`);
        return null;
    }
}

/**
 * AI Trading System - Evaluates strategies and generates trading signals
 */
export const aiTradingSystem = async () => {
    log('Starting AI trading system...');

    try {
        // Get symbols with recent indicators (last 24 hours)
        const symbolsResult = await clickhouseClient.query({
            query: `
                SELECT DISTINCT symbol
                FROM ${CLICKHOUSE_CONFIG.database}.technical_indicators
                WHERE date >= today() - INTERVAL 1 DAY
                LIMIT 500
            `,
            format: 'JSONEachRow',
        });

        const symbols = await symbolsResult.json();
        log(`Evaluating AI strategies for ${symbols.length} symbols`);

        const strategyResults: any[] = [];
        const signals: any[] = [];
        let processedCount = 0;
        let errorCount = 0;

        // AI strategies to evaluate
        const strategies = ['neuro-scalp', 'deep-momentum', 'sentiment-flow'];

        for (const { symbol } of symbols) {
            try {
                // Get latest market data
                const latestData = await getLatestMarketData(symbol);
                if (!latestData || !latestData.price) {
                    continue;
                }

                // Get historical prices
                const historicalPrices = await getHistoricalPrices(symbol, 50);
                if (historicalPrices.length < 20) {
                    continue; // Not enough data
                }

                // Get latest indicators
                const indicators = await getLatestIndicators(symbol);
                if (!indicators) {
                    continue; // No indicators available
                }

                // Prepare market data for AI strategies
                const marketData: MarketData = {
                    symbol,
                    price: latestData.price,
                    volume: 0, // Not used in current strategies
                    historicalPrices,
                    timestamp: Date.now(),
                };

                // Evaluate each strategy
                for (const strategy of strategies) {
                    try {
                        // Generate AI signal (sentiment-flow uses sentiment score, defaulting to 0)
                        const signal = generateAISignal(marketData, strategy, 0);

                        const timestamp = new Date();

                        // Store strategy result
                        strategyResults.push({
                            timestamp,
                            symbol,
                            strategy,
                            action: signal.action,
                            confidence: signal.confidence,
                            reason: signal.reason,
                            price: marketData.price,
                            rsi: signal.technicalIndicators.rsi || indicators.rsi || null,
                            macd: signal.technicalIndicators.macd || indicators.macd_value || null,
                            bb_upper: signal.technicalIndicators.bollingerBands?.upper || null,
                            bb_middle: signal.technicalIndicators.bollingerBands?.middle || null,
                            bb_lower: signal.technicalIndicators.bollingerBands?.lower || null,
                            sma20: signal.technicalIndicators.movingAverages?.sma20 || null,
                            sma50: signal.technicalIndicators.movingAverages?.sma50 || null,
                            ema12: signal.technicalIndicators.movingAverages?.ema12 || null,
                            ema26: signal.technicalIndicators.movingAverages?.ema26 || null,
                        });

                        // Store high-confidence signals (>75%) in ai_signals table
                        if (signal.confidence > 75) {
                            const signalId = uuidv4();
                            signals.push({
                                signal_id: signalId,
                                timestamp,
                                symbol,
                                strategy,
                                action: signal.action,
                                confidence: signal.confidence,
                                reason: signal.reason,
                                price: marketData.price,
                                status: 'pending',
                                executed_at: null,
                                trade_id: null,
                                updated_at: timestamp,
                            });
                        }
                    } catch (error: any) {
                        log(`Error evaluating strategy ${strategy} for ${symbol}: ${error.message}`);
                    }
                }

                processedCount++;
            } catch (error: any) {
                errorCount++;
                log(`Error processing ${symbol}: ${error.message}`);
            }
        }

        // Batch insert strategy results
        if (strategyResults.length > 0) {
            await insertMany(strategyResults, `${CLICKHOUSE_CONFIG.database}.ai_strategy_results`);
            log(`AI strategy results: ${strategyResults.length} results queued`);
        }

        // Batch insert high-confidence signals
        if (signals.length > 0) {
            await insertMany(signals, `${CLICKHOUSE_CONFIG.database}.ai_signals`);
            log(`AI signals: ${signals.length} high-confidence signals (>75%) queued`);
        }

        log(`AI trading system: ${processedCount} symbols processed, ${errorCount} errors`);
    } catch (error: any) {
        log(`AI trading system failed: ${error.message}`);
        throw error;
    }

    log('AI trading system completed.');
};

