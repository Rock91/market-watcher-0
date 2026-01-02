import { insertMany } from '../compute/batchWriter';
import { log } from '../utils/logger';
import { getMarketMovers } from '../../server/services/yahooFinance';
import { CLICKHOUSE_CONFIG } from '../../server/config/database';
import { retryWithBackoff, sleep } from '../utils/rateLimiter';

/**
 * Fetch top 20 stocks (gainers and losers) market data
 */
export const marketDataSync = async () => {
    log('Starting top 20 stocks market data sync...');
    
    try {
        const rows: any[] = [];
        const timestamp = new Date();

        // Fetch top 20 gainers with retry logic
        try {
            // Add initial delay to avoid hitting rate limits when running in parallel
            await sleep(500);
            
            const gainers = await retryWithBackoff(
                () => getMarketMovers('gainers', 20),
                3,
                2000
            );
            log(`Fetched ${gainers.length} gainers`);

            for (const mover of gainers) {
                rows.push({
                    timestamp,
                    symbol: mover.symbol,
                    strategy: 'market_movers',
                    action: 'HOLD',
                    confidence: 0,
                    reason: `Top gainer: ${mover.changePercent.toFixed(2)}%`,
                    price: mover.price,
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
        } catch (error: any) {
            log(`Error fetching gainers: ${error.message}`);
            // Continue even if gainers fail
        }

        // Wait before fetching losers to avoid rate limits
        await sleep(1000);

        // Fetch top 20 losers with retry logic
        try {
            const losers = await retryWithBackoff(
                () => getMarketMovers('losers', 20),
                3,
                2000
            );
            log(`Fetched ${losers.length} losers`);

            for (const mover of losers) {
                rows.push({
                    timestamp,
                    symbol: mover.symbol,
                    strategy: 'market_movers',
                    action: 'HOLD',
                    confidence: 0,
                    reason: `Top loser: ${mover.changePercent.toFixed(2)}%`,
                    price: mover.price,
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
        } catch (error: any) {
            log(`Error fetching losers: ${error.message}`);
            // Continue even if losers fail
        }

        // Batch insert all market mover data
        if (rows.length > 0) {
            await insertMany(rows, `${CLICKHOUSE_CONFIG.database}.ai_strategy_results`);
            log(`Top 20 stocks sync: ${rows.length} rows queued`);
        } else {
            log('No market mover rows to insert');
        }
    } catch (error: any) {
        log(`Top 20 stocks sync failed: ${error.message}`);
        throw error;
    }

    log('Top 20 stocks sync completed.');
};

