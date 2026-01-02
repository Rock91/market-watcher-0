import { historicalDataSync } from './fetch/historicalDataSync';
import { dataSync5min } from './fetch/dataSync5min';
import { marketDataSync } from './fetch/marketDataSync';
import { technicalIndicatorsSync } from './compute/technicalIndicators';
import { aiTradingSystem } from './ai/aiTradingSystem';
import { flushAll } from './compute/batchWriter';
import { log } from './utils/logger';
import { initializeClickHouse } from '../server/database/tables';

/**
 * Main pipeline runner - executes all data fetching, processing, and AI trading steps
 */
const runAll = async () => {
    log('Pipeline started...');

    try {
        // Step 0: Initialize ClickHouse database and tables
        log('Step 0: Initializing ClickHouse database and tables...');
        await initializeClickHouse();
        log('Database initialization completed.');
        // Step 1: Fetch data with staggered starts to avoid rate limits
        // Run in parallel but with delays to prevent hitting rate limits simultaneously
        log('Step 1: Fetching market data (staggered parallel execution)...');
        
        // Helper to delay execution
        const delay = (ms: number, fn: () => Promise<any>) => 
            new Promise((resolve, reject) => {
                setTimeout(async () => {
                    try {
                        resolve(await fn());
                    } catch (error) {
                        reject(error);
                    }
                }, ms);
            });

        // Start all three with small delays to stagger requests
        const [historicalResult, data5minResult, marketResult] = await Promise.allSettled([
            historicalDataSync(),
            delay(500, dataSync5min),
            delay(1000, marketDataSync)
        ]);

        // Log any failures but continue
        if (historicalResult.status === 'rejected') {
            log(`Historical data sync failed: ${historicalResult.reason?.message || 'Unknown error'}`);
        }
        if (data5minResult.status === 'rejected') {
            log(`5-min data sync failed: ${data5minResult.reason?.message || 'Unknown error'}`);
        }
        if (marketResult.status === 'rejected') {
            log(`Market data sync failed: ${marketResult.reason?.message || 'Unknown error'}`);
        }

        // Step 2: Flush all pending rows to ClickHouse
        log('Step 2: Flushing all pending data to ClickHouse...');
        await flushAll();

        // Step 3: Compute technical indicators (incremental - only for new data)
        log('Step 3: Calculating technical indicators...');
        await technicalIndicatorsSync();
        await flushAll();

        // Step 4: Run AI trading system (triggered after new indicators)
        log('Step 4: Running AI trading system...');
        await aiTradingSystem();
        await flushAll();

        log('Pipeline completed successfully!');
    } catch (error: any) {
        log(`Pipeline failed: ${error.message}`);
        console.error('Pipeline error:', error);
        process.exit(1);
    }
};

// Run the pipeline
runAll().catch(err => {
    console.error('Fatal pipeline error:', err);
    process.exit(1);
});

