# Market Data Pipeline - Complete Documentation

## 📁 Project Structure

```
src/
├── index.ts                    # Main entry point - orchestrates entire pipeline
├── fetch/                      # Data fetching modules (parallel execution)
│   ├── historicalDataSync.ts  # Fetches 30-day historical data
│   ├── dataSync5min.ts         # Fetches 5-minute interval data
│   └── marketDataSync.ts      # Fetches top 20 gainers/losers
├── compute/                     # Data processing modules
│   ├── batchWriter.ts         # Central batch insert handler (WSL-safe)
│   └── technicalIndicators.ts # Incremental technical indicators calculation
├── ai/                         # AI trading system
│   └── aiTradingSystem.ts     # Strategy evaluation & signal generation
└── utils/                      # Utility modules
    ├── logger.ts              # Logging utility
    └── rateLimiter.ts         # Rate limiting & retry logic
```

---

## 🔄 Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Step 0: Initialization                  │
│  - Initialize ClickHouse database                           │
│  - Create all required tables                              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│              Step 1: Parallel Data Fetching                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Historical   │  │   5-Min      │  │   Market     │    │
│  │ Data Sync    │  │   Data Sync  │  │   Movers     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│  (30-day data)     (Current quotes)   (Top 20 stocks)     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│              Step 2: Batch Insert to ClickHouse            │
│  - Flush all buffered data (1000 rows per batch)            │
│  - WSL-safe bulk insert strategy                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│         Step 3: Technical Indicators Calculation            │
│  - Incremental calculation (only new data)                  │
│  - RSI, MACD, SMA, EMA, Volatility                          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│              Step 4: AI Trading System                       │
│  - Evaluate 3 strategies per symbol                         │
│  - Generate trading signals (>75% confidence)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 📚 Module Documentation

### 1. `src/index.ts` - Main Pipeline Orchestrator

**Purpose**: Entry point that coordinates all pipeline steps

**Functions**:
- `runAll()`: Main pipeline execution function
  - Initializes database
  - Runs parallel data fetching
  - Processes data sequentially
  - Handles errors gracefully

**Key Features**:
- Staggered parallel execution (prevents rate limits)
- Error handling with `Promise.allSettled()`
- Continues even if one step fails

**How to Modify**:
```typescript
// Add new step after indicators:
await technicalIndicatorsSync();
await flushAll();

// Add your custom step here:
await yourCustomStep();
await flushAll();
```

---

### 2. `src/fetch/historicalDataSync.ts` - Historical Data Fetcher

**Purpose**: Fetches 30 days of historical price data for all tracked symbols

**Functions**:
- `historicalDataSync()`: Main function
  - Gets tracked symbols from ClickHouse
  - Fetches historical data from Yahoo Finance
  - Transforms data to match table schema
  - Batches inserts via `batchWriter`

**Data Flow**:
```
getTrackedSymbols() → getHistoricalData() → transform → insertMany()
```

**Key Features**:
- Retry logic with exponential backoff
- Rate limiting (300ms delay between requests)
- Error handling per symbol (continues on failure)

**How to Modify**:
```typescript
// Change date range:
startDate.setDate(startDate.getDate() - 60); // 60 days instead of 30

// Change interval:
getHistoricalData(symbol, startDate, endDate, '1wk'); // Weekly instead of daily

// Add custom fields:
rows.push({
    // ... existing fields
    customField: yourValue
});
```

**Dependencies**:
- `getTrackedSymbols()` from `server/services/clickhouse`
- `getHistoricalData()` from `server/services/yahooFinance`
- `insertMany()` from `batchWriter`

---

### 3. `src/fetch/dataSync5min.ts` - 5-Minute Data Fetcher

**Purpose**: Fetches current market quotes and stores as 5-minute snapshots

**Functions**:
- `dataSync5min()`: Main function
  - Gets tracked symbols
  - Fetches current quotes
  - Rounds timestamps to 5-minute intervals
  - Batches inserts

**Data Flow**:
```
getTrackedSymbols() → getStockQuote() → roundTimestamp() → insertMany()
```

**Key Features**:
- Timestamp rounding to nearest 5 minutes
- Rate limiting (200ms delay)
- Retry logic for failed requests

**How to Modify**:
```typescript
// Change interval (e.g., 15 minutes):
const roundedMinutes = Math.floor(now.getMinutes() / 15) * 15;

// Add volume tracking:
rows.push({
    // ... existing fields
    volume: quote.volume
});
```

**Dependencies**:
- `getTrackedSymbols()` from `server/services/clickhouse`
- `getStockQuote()` from `server/services/yahooFinance`
- `insertMany()` from `batchWriter`

---

### 4. `src/fetch/marketDataSync.ts` - Market Movers Fetcher

**Purpose**: Fetches top 20 gainers and losers from market

**Functions**:
- `marketDataSync()`: Main function
  - Fetches gainers (top 20)
  - Waits 1 second
  - Fetches losers (top 20)
  - Batches inserts

**Data Flow**:
```
getMarketMovers('gainers') → transform → sleep(1000) → getMarketMovers('losers') → insertMany()
```

**Key Features**:
- Separate requests for gainers/losers
- Delay between requests (prevents rate limits)
- Retry logic with backoff

**How to Modify**:
```typescript
// Change count:
const gainers = await getMarketMovers('gainers', 50); // Top 50 instead of 20

// Add more data sources:
const trending = await getTrendingSymbols('US', 20);
// ... add to rows array
```

**Dependencies**:
- `getMarketMovers()` from `server/services/yahooFinance`
- `insertMany()` from `batchWriter`
- `retryWithBackoff()` from `rateLimiter`

---

### 5. `src/compute/batchWriter.ts` - Central Batch Writer

**Purpose**: Handles all ClickHouse inserts with batching and WSL-safe strategy

**Functions**:
- `insertMany(rows, tableName)`: Adds rows to buffer, flushes when batch size reached
- `flush(tableName)`: Flushes specific table's buffer to ClickHouse
- `flushAll()`: Flushes all table buffers

**Key Features**:
- Batch size: 1000 rows (configurable)
- Per-table buffering (multiple tables supported)
- Automatic date conversion for ClickHouse
- WSL-safe bulk insert using ClickHouse client
- Error handling with buffer restoration

**Data Structure**:
```typescript
buffers: Map<string, any[]>  // tableName → array of rows
```

**How to Modify**:
```typescript
// Change batch size:
const BATCH_SIZE = 2000; // Larger batches

// Add custom validation:
export const insertMany = async (rows: any[], tableName: string) => {
    // Validate rows before adding
    const validRows = rows.filter(row => validateRow(row));
    // ... rest of function
};

// Add metrics:
export const getBufferStats = () => {
    return Array.from(buffers.entries()).map(([table, rows]) => ({
        table,
        count: rows.length
    }));
};
```

**Dependencies**:
- `clickhouseClient` from `server/database/client`
- `CLICKHOUSE_CONFIG` from `server/config/database`

---

### 6. `src/compute/technicalIndicators.ts` - Technical Indicators Calculator

**Purpose**: Calculates technical indicators incrementally (only for new data)

**Functions**:
- `technicalIndicatorsSync()`: Main function
  - Gets symbols with recent data
  - Finds last calculated timestamp per symbol
  - Fetches new data since last calculation
  - Calculates indicators
  - Inserts results

**Helper Functions**:
- `getLastIndicatorTimestamp(symbol)`: Gets last calculation date
- `getNewMarketData(symbol, lastTimestamp)`: Fetches new rows
- `getHistoricalPrices(symbol, endDate, days)`: Gets price history for calculations

**Indicators Calculated**:
- RSI (Relative Strength Index) - 14 period
- MACD (Moving Average Convergence Divergence) - 12/26/9
- SMA20, SMA50 (Simple Moving Averages)
- EMA12, EMA26 (Exponential Moving Averages)
- Volatility (Standard Deviation)

**Data Flow**:
```
getSymbols() → for each symbol:
    getLastTimestamp() → getNewData() → getHistoricalPrices() → 
    calculateIndicators() → insertMany()
```

**Key Features**:
- Incremental calculation (only processes new data)
- Groups data by date
- Requires minimum 14 data points for RSI
- Requires minimum 26 data points for MACD

**How to Modify**:
```typescript
// Add new indicator:
const newIndicator = calculateYourIndicator(historicalPrices);
indicators.push({
    // ... existing fields
    your_indicator: newIndicator
});

// Change calculation periods:
const rsi = calculateRSI(historicalPrices, 21); // 21 period instead of 14

// Add custom calculation logic:
if (historicalPrices.length >= 50) {
    const customMA = calculateCustomMA(historicalPrices, 50);
    // ... add to indicators
}
```

**Dependencies**:
- `calculateRSI`, `calculateEMA`, `calculateMACD`, `calculateVolatility` from `server/services/technicalIndicators`
- `clickhouseClient` for queries
- `insertMany()` from `batchWriter`

---

### 7. `src/ai/aiTradingSystem.ts` - AI Trading System

**Purpose**: Evaluates AI trading strategies and generates signals

**Functions**:
- `aiTradingSystem()`: Main function
  - Gets symbols with recent indicators
  - For each symbol:
    - Gets latest market data
    - Gets historical prices
    - Gets latest indicators
    - Evaluates 3 strategies
    - Stores results
    - Creates signals for high-confidence trades (>75%)

**Helper Functions**:
- `getLatestIndicators(symbol)`: Gets most recent technical indicators
- `getHistoricalPrices(symbol, limit)`: Gets price history for strategies
- `getLatestMarketData(symbol)`: Gets current market data

**Strategies Evaluated**:
1. **neuro-scalp**: High-frequency trading strategy
2. **deep-momentum**: Trend following strategy
3. **sentiment-flow**: Sentiment-based strategy

**Data Flow**:
```
getSymbolsWithIndicators() → for each symbol:
    getLatestData() → getHistoricalPrices() → getLatestIndicators() →
    for each strategy:
        generateAISignal() → storeResult() → 
        if confidence > 75%: storeSignal()
```

**Key Features**:
- Evaluates multiple strategies per symbol
- Only processes symbols with fresh indicators
- Requires minimum 20 data points
- Stores all results in `ai_strategy_results`
- Stores high-confidence signals (>75%) in `ai_signals`

**How to Modify**:
```typescript
// Add new strategy:
const strategies = ['neuro-scalp', 'deep-momentum', 'sentiment-flow', 'your-strategy'];

// Change confidence threshold:
if (signal.confidence > 80) { // 80% instead of 75%

// Add custom strategy evaluation:
const customSignal = yourCustomStrategy(marketData, indicators);
strategyResults.push({
    // ... existing fields
    strategy: 'custom-strategy',
    // ... custom fields
});

// Add sentiment score:
const sentimentScore = await getSentimentScore(symbol);
const signal = generateAISignal(marketData, 'sentiment-flow', sentimentScore);
```

**Dependencies**:
- `generateAISignal()` from `server/services/ai-strategies`
- `clickhouseClient` for queries
- `insertMany()` from `batchWriter`
- `uuid` for signal IDs

---

### 8. `src/utils/logger.ts` - Logging Utility

**Purpose**: Centralized logging with timestamps

**Functions**:
- `log(msg)`: Logs message with ISO timestamp

**Usage**:
```typescript
log('Pipeline started...');
// Output: [2026-01-02T12:00:00.000Z] Pipeline started...
```

**How to Modify**:
```typescript
// Add log levels:
export const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`${prefix} [${new Date().toISOString()}] ${msg}`);
};

// Add file logging:
import fs from 'fs';
export const log = (msg: string) => {
    const logMsg = `[${new Date().toISOString()}] ${msg}\n`;
    console.log(logMsg);
    fs.appendFileSync('pipeline.log', logMsg);
};
```

---

### 9. `src/utils/rateLimiter.ts` - Rate Limiting Utility

**Purpose**: Prevents API rate limiting with retry logic

**Functions**:
- `sleep(ms)`: Delays execution
- `retryWithBackoff(fn, maxRetries, baseDelay)`: Retries function with exponential backoff

**Retry Strategy**:
- Attempt 1: Immediate
- Attempt 2: Wait 2 seconds (baseDelay * 2^0)
- Attempt 3: Wait 4 seconds (baseDelay * 2^1)
- Attempt 4: Wait 8 seconds (baseDelay * 2^2)

**How to Modify**:
```typescript
// Change retry strategy:
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 5, // More retries
    baseDelay: number = 500  // Shorter base delay
): Promise<T> {
    // ... implementation
}

// Add jitter to prevent thundering herd:
const jitter = Math.random() * 1000; // 0-1000ms random
const delay = baseDelay * Math.pow(2, attempt) + jitter;
```

---

## 🗄️ Database Tables

### `ai_strategy_results`
Stores all strategy evaluations and market data.

**Schema**:
```sql
timestamp DateTime
symbol LowCardinality(String)
strategy LowCardinality(String)
action LowCardinality(String)  -- 'BUY', 'SELL', 'HOLD'
confidence Float64
reason String
price Float64
rsi Nullable(Float64)
macd Nullable(Float64)
bb_upper Nullable(Float64)
bb_middle Nullable(Float64)
bb_lower Nullable(Float64)
sma20 Nullable(Float64)
sma50 Nullable(Float64)
ema12 Nullable(Float64)
ema26 Nullable(Float64)
```

**Partitioned by**: `toYYYYMM(timestamp)`
**Ordered by**: `(symbol, timestamp, strategy)`
**TTL**: 30 days

### `technical_indicators`
Stores calculated technical indicators.

**Schema**:
```sql
date Date
symbol LowCardinality(String)
rsi Float64
macd_value Float64
macd_signal Float64
macd_histogram Float64
volatility Float64
volatility_percent Float64
data_points UInt32
calculated_at DateTime
```

**Partitioned by**: `toYYYYMM(date)`
**Ordered by**: `(symbol, date)`
**TTL**: 1 year

### `ai_signals`
Stores high-confidence trading signals (>75%).

**Schema**:
```sql
signal_id String
timestamp DateTime
symbol LowCardinality(String)
strategy LowCardinality(String)
action LowCardinality(String)
confidence Float64
reason String
price Float64
status LowCardinality(String)  -- 'pending', 'executed', 'cancelled'
executed_at Nullable(DateTime)
trade_id Nullable(String)
updated_at DateTime
```

---

## 🔧 Configuration

### ClickHouse Configuration
Located in: `server/config/database.ts`

```typescript
CLICKHOUSE_CONFIG = {
    host: 'localhost',
    port: '8123',
    username: 'default',
    password: '1703',
    database: 'market_data'
}
```

### Batch Size
Located in: `src/compute/batchWriter.ts`

```typescript
const BATCH_SIZE = 1000; // Rows per batch
```

### Rate Limiting
Delays between requests:
- Historical data: 300ms
- 5-min data: 200ms
- Market movers: 1000ms between gainers/losers

---

## 🚀 How to Extend

### Adding a New Data Source

1. Create new file: `src/fetch/yourDataSync.ts`
```typescript
import { insertMany } from '../compute/batchWriter';
import { log } from '../utils/logger';
import { retryWithBackoff, sleep } from '../utils/rateLimiter';

export const yourDataSync = async () => {
    log('Starting your data sync...');
    
    const rows: any[] = [];
    // Fetch your data
    const data = await fetchYourData();
    
    // Transform to match schema
    for (const item of data) {
        rows.push({
            timestamp: new Date(),
            symbol: item.symbol,
            strategy: 'your_strategy',
            action: 'HOLD',
            confidence: 0,
            reason: 'Your data source',
            price: item.price,
            // ... other fields
        });
    }
    
    await insertMany(rows, 'market_data.ai_strategy_results');
    log('Your data sync completed.');
};
```

2. Add to `src/index.ts`:
```typescript
import { yourDataSync } from './fetch/yourDataSync';

// In runAll():
await Promise.allSettled([
    historicalDataSync(),
    dataSync5min(),
    marketDataSync(),
    yourDataSync()  // Add here
]);
```

### Adding a New Technical Indicator

1. Add calculation function to `server/services/technicalIndicators.ts`:
```typescript
export function calculateYourIndicator(prices: number[]): number {
    // Your calculation logic
    return result;
}
```

2. Update `src/compute/technicalIndicators.ts`:
```typescript
import { calculateYourIndicator } from '../../server/services/technicalIndicators';

// In technicalIndicatorsSync():
const yourIndicator = calculateYourIndicator(historicalPrices);

indicators.push({
    // ... existing fields
    your_indicator: yourIndicator
});
```

3. Update table schema in `server/database/tables/indicators.ts`:
```sql
your_indicator Float64,
```

### Adding a New AI Strategy

1. Add strategy function to `server/services/ai-strategies.ts`:
```typescript
export function yourStrategy(marketData: MarketData): TradingSignal {
    // Your strategy logic
    return {
        symbol: marketData.symbol,
        action: 'BUY',
        confidence: 85,
        reason: 'Your strategy reason',
        technicalIndicators: { /* ... */ }
    };
}
```

2. Update `src/ai/aiTradingSystem.ts`:
```typescript
const strategies = ['neuro-scalp', 'deep-momentum', 'sentiment-flow', 'your-strategy'];

// In generateAISignal switch:
case 'your-strategy':
    return yourStrategy(marketData);
```

---

## 🐛 Troubleshooting

### Rate Limit Errors (429)
- Increase delays in fetch modules
- Reduce batch sizes
- Add more retry attempts

### Table Not Found Errors
- Ensure `initializeClickHouse()` runs first
- Check table names match exactly
- Verify database exists

### Missing Data
- Check if symbols exist in `tracked_symbols` table
- Verify Yahoo Finance API is accessible
- Check error logs for specific failures

### Performance Issues
- Increase `BATCH_SIZE` for faster inserts
- Reduce number of symbols processed
- Add parallel processing for indicators

---

## 📊 Monitoring

### Check Pipeline Status
```typescript
// Add to index.ts:
log(`Pipeline stats: ${processedSymbols} symbols, ${totalRows} rows`);
```

### Monitor Buffer Sizes
```typescript
// Add to batchWriter.ts:
export const getBufferStats = () => {
    return Array.from(buffers.entries()).map(([table, rows]) => ({
        table,
        count: rows.length
    }));
};
```

### Query Recent Data
```sql
-- Check recent strategy results
SELECT * FROM market_data.ai_strategy_results 
WHERE timestamp >= now() - INTERVAL 1 HOUR
ORDER BY timestamp DESC
LIMIT 100;

-- Check recent indicators
SELECT * FROM market_data.technical_indicators
WHERE date >= today() - INTERVAL 7 DAY
ORDER BY date DESC;
```

---

## 🔐 Best Practices

1. **Always use `insertMany()` for inserts** - Don't insert directly to ClickHouse
2. **Call `flushAll()` after each step** - Ensures data is persisted
3. **Handle errors gracefully** - Use try/catch and continue on failure
4. **Use retry logic** - Wrap API calls with `retryWithBackoff()`
5. **Add delays** - Prevent rate limiting with `sleep()`
6. **Log everything** - Use `log()` for debugging
7. **Validate data** - Check data before inserting
8. **Test incrementally** - Test each module separately

---

## 📝 Summary

This pipeline:
- ✅ Fetches market data from multiple sources in parallel
- ✅ Uses centralized batch writing for efficiency
- ✅ Calculates indicators incrementally
- ✅ Evaluates AI strategies automatically
- ✅ Handles errors gracefully
- ✅ Prevents rate limiting
- ✅ Is modular and extensible

Each module is independent and can be modified without affecting others. The pipeline is designed to be robust, efficient, and easy to extend.

