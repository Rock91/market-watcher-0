# Function Map - Complete Function Reference

## 📋 Index by Module

### 1. `src/index.ts`

#### `runAll()`
- **Purpose**: Main pipeline orchestrator
- **Returns**: `Promise<void>`
- **Calls**:
  - `initializeClickHouse()` - Database setup
  - `historicalDataSync()` - Fetch historical data
  - `dataSync5min()` - Fetch 5-min data
  - `marketDataSync()` - Fetch market movers
  - `flushAll()` - Flush all buffers
  - `technicalIndicatorsSync()` - Calculate indicators
  - `aiTradingSystem()` - Run AI strategies
- **Error Handling**: Catches all errors, logs, exits with code 1

---

### 2. `src/fetch/historicalDataSync.ts`

#### `historicalDataSync()`
- **Purpose**: Fetch 30-day historical data for tracked symbols
- **Returns**: `Promise<void>`
- **Calls**:
  - `getTrackedSymbols(30, 1000)` - Get symbols to process
  - `retryWithBackoff(() => getHistoricalData(...))` - Fetch with retry
  - `insertMany(rows, tableName)` - Batch insert
- **Processes**: All tracked symbols from last 30 days
- **Rate Limiting**: 300ms delay between symbols, 1s initial delay
- **Error Handling**: Continues on per-symbol failures

---

### 3. `src/fetch/dataSync5min.ts`

#### `dataSync5min()`
- **Purpose**: Fetch current quotes as 5-minute snapshots
- **Returns**: `Promise<void>`
- **Calls**:
  - `getTrackedSymbols(7, 1000)` - Get recent symbols
  - `retryWithBackoff(() => getStockQuote(symbol))` - Fetch with retry
  - `insertMany(rows, tableName)` - Batch insert
- **Processes**: All tracked symbols from last 7 days
- **Rate Limiting**: 200ms delay between symbols, 2s initial delay
- **Timestamp Rounding**: Rounds to nearest 5 minutes

---

### 4. `src/fetch/marketDataSync.ts`

#### `marketDataSync()`
- **Purpose**: Fetch top 20 gainers and losers
- **Returns**: `Promise<void>`
- **Calls**:
  - `sleep(500)` - Initial delay
  - `retryWithBackoff(() => getMarketMovers('gainers', 20))` - Fetch gainers
  - `sleep(1000)` - Delay between gainers/losers
  - `retryWithBackoff(() => getMarketMovers('losers', 20))` - Fetch losers
  - `insertMany(rows, tableName)` - Batch insert
- **Processes**: Top 20 gainers + top 20 losers
- **Rate Limiting**: 1s delay between gainers and losers, 500ms initial delay

---

### 5. `src/compute/batchWriter.ts`

#### `insertMany(rows: any[], tableName: string)`
- **Purpose**: Add rows to buffer, auto-flush when batch size reached
- **Parameters**:
  - `rows`: Array of row objects
  - `tableName`: Full table name (e.g., `market_data.ai_strategy_results`)
- **Returns**: `Promise<void>`
- **Process**:
  1. Converts Date objects to ClickHouse DateTime strings
  2. Adds rows to table-specific buffer
  3. If buffer >= BATCH_SIZE (1000), calls `flush()`
- **Error Handling**: Re-adds rows to buffer on failure

#### `flush(tableName: string)`
- **Purpose**: Flush specific table's buffer to ClickHouse
- **Parameters**: `tableName` - Table to flush
- **Returns**: `Promise<void>`
- **Process**:
  1. Gets all rows from buffer
  2. Clears buffer
  3. Bulk inserts to ClickHouse using JSONEachRow format
  4. On error, restores rows to buffer
- **Error Handling**: Throws error, preserves data in buffer

#### `flushAll()`
- **Purpose**: Flush all table buffers
- **Returns**: `Promise<void>`
- **Process**: Calls `flush()` for each table in buffers Map
- **Error Handling**: Continues flushing other tables on error

#### `dateToClickHouseDateTime(date: Date)`
- **Purpose**: Convert JavaScript Date to ClickHouse DateTime format
- **Returns**: `string` - Format: `'YYYY-MM-DD HH:MM:SS'`
- **Used Internally**: By `insertMany()` for date conversion

---

### 6. `src/compute/technicalIndicators.ts`

#### `technicalIndicatorsSync()`
- **Purpose**: Calculate technical indicators incrementally
- **Returns**: `Promise<void>`
- **Calls**:
  - `clickhouseClient.query()` - Get symbols with recent data
  - `getLastIndicatorTimestamp(symbol)` - Get last calculation
  - `getNewMarketData(symbol, lastTimestamp)` - Get new rows
  - `getHistoricalPrices(symbol, endDate, 50)` - Get price history
  - `calculateRSI()`, `calculateMACD()`, `calculateEMA()`, `calculateVolatility()` - Calculate indicators
  - `insertMany(indicators, tableName)` - Batch insert
- **Process**: For each symbol, only processes data since last calculation
- **Requirements**: Minimum 14 data points for RSI, 26 for MACD

#### `getLastIndicatorTimestamp(symbol: string)`
- **Purpose**: Get most recent indicator calculation date for symbol
- **Returns**: `Promise<Date | null>`
- **Query**: `SELECT max(date) FROM technical_indicators WHERE symbol = ?`
- **Returns**: `null` if no indicators exist yet

#### `getNewMarketData(symbol: string, lastTimestamp: Date | null)`
- **Purpose**: Get market data rows since last indicator calculation
- **Parameters**:
  - `symbol`: Stock symbol
  - `lastTimestamp`: Last calculation timestamp (null for first run)
- **Returns**: `Promise<any[]>` - Array of market data rows
- **Query**: `SELECT timestamp, symbol, price FROM ai_strategy_results WHERE symbol = ? AND timestamp > ?`
- **Limit**: 1000 rows per symbol

#### `getHistoricalPrices(symbol: string, endDate: Date, days: number)`
- **Purpose**: Get historical prices for indicator calculations
- **Parameters**:
  - `symbol`: Stock symbol
  - `endDate`: End date for price history
  - `days`: Number of days to fetch (default: 50)
- **Returns**: `Promise<number[]>` - Array of prices in chronological order
- **Query**: `SELECT price FROM ai_strategy_results WHERE symbol = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`

---

### 7. `src/ai/aiTradingSystem.ts`

#### `aiTradingSystem()`
- **Purpose**: Evaluate AI strategies and generate trading signals
- **Returns**: `Promise<void>`
- **Calls**:
  - `clickhouseClient.query()` - Get symbols with fresh indicators
  - `getLatestMarketData(symbol)` - Get current market data
  - `getHistoricalPrices(symbol, 50)` - Get price history
  - `getLatestIndicators(symbol)` - Get latest indicators
  - `generateAISignal(marketData, strategy, sentimentScore)` - Evaluate strategy
  - `insertMany(strategyResults, tableName)` - Store results
  - `insertMany(signals, tableName)` - Store high-confidence signals
- **Process**: Evaluates 3 strategies per symbol, stores all results, creates signals for >75% confidence
- **Requirements**: Minimum 20 data points, fresh indicators (last 24 hours)

#### `getLatestIndicators(symbol: string)`
- **Purpose**: Get most recent technical indicators for symbol
- **Returns**: `Promise<any | null>`
- **Query**: `SELECT rsi, macd_value, macd_signal, macd_histogram, volatility, volatility_percent FROM technical_indicators WHERE symbol = ? ORDER BY date DESC LIMIT 1`
- **Returns**: `null` if no indicators exist

#### `getHistoricalPrices(symbol: string, limit: number)`
- **Purpose**: Get recent historical prices for strategy evaluation
- **Parameters**:
  - `symbol`: Stock symbol
  - `limit`: Number of prices to fetch (default: 50)
- **Returns**: `Promise<number[]>` - Array of prices in chronological order
- **Query**: `SELECT price FROM ai_strategy_results WHERE symbol = ? AND price > 0 ORDER BY timestamp DESC LIMIT ?`
- **Note**: Reverses array to get chronological order

#### `getLatestMarketData(symbol: string)`
- **Purpose**: Get most recent market data point for symbol
- **Returns**: `Promise<any | null>`
- **Query**: `SELECT timestamp, symbol, price FROM ai_strategy_results WHERE symbol = ? AND price > 0 ORDER BY timestamp DESC LIMIT 1`
- **Returns**: `null` if no data exists

---

### 8. `src/utils/logger.ts`

#### `log(msg: string)`
- **Purpose**: Log message with ISO timestamp
- **Parameters**: `msg` - Message to log
- **Returns**: `void`
- **Output Format**: `[YYYY-MM-DDTHH:mm:ss.sssZ] message`
- **Implementation**: `console.log()`

---

### 9. `src/utils/rateLimiter.ts`

#### `sleep(ms: number)`
- **Purpose**: Delay execution for specified milliseconds
- **Parameters**: `ms` - Milliseconds to wait
- **Returns**: `Promise<void>`
- **Implementation**: `setTimeout()` wrapped in Promise

#### `retryWithBackoff<T>(fn, maxRetries, baseDelay)`
- **Purpose**: Retry function with exponential backoff on rate limit errors
- **Parameters**:
  - `fn`: Function to retry `() => Promise<T>`
  - `maxRetries`: Maximum retry attempts (default: 3)
  - `baseDelay`: Base delay in ms (default: 1000)
- **Returns**: `Promise<T>`
- **Retry Strategy**:
  - Attempt 1: Immediate
  - Attempt 2: Wait `baseDelay * 2^0` (1s)
  - Attempt 3: Wait `baseDelay * 2^1` (2s)
  - Attempt 4: Wait `baseDelay * 2^2` (4s)
- **Rate Limit Detection**: Checks for 429 status code or "Too Many Requests" message
- **Error Handling**: Throws error if max retries reached or non-rate-limit error

---

## 🔗 External Dependencies

### From `server/services/clickhouse.ts`
- `getTrackedSymbols(days, limit)` - Get tracked symbols from database

### From `server/services/yahooFinance.ts`
- `getHistoricalData(symbol, period1, period2, interval)` - Fetch historical data
- `getStockQuote(symbol)` - Get current stock quote
- `getMarketMovers(type, count)` - Get market movers (gainers/losers)

### From `server/services/technicalIndicators.ts`
- `calculateRSI(prices, period)` - Calculate RSI
- `calculateMACD(prices)` - Calculate MACD
- `calculateEMA(prices, period)` - Calculate EMA
- `calculateVolatility(prices, period)` - Calculate volatility

### From `server/services/ai-strategies.ts`
- `generateAISignal(marketData, strategy, sentimentScore)` - Generate trading signal

### From `server/database/client.ts`
- `clickhouseClient` - ClickHouse client instance

### From `server/database/tables.ts`
- `initializeClickHouse()` - Initialize database and tables

### From `server/config/database.ts`
- `CLICKHOUSE_CONFIG` - Database configuration

---

## 📊 Function Call Graph

```
runAll()
├── initializeClickHouse()
│   └── (creates tables)
├── historicalDataSync()
│   ├── getTrackedSymbols()
│   ├── retryWithBackoff()
│   │   └── getHistoricalData()
│   └── insertMany()
│       └── flush() [if buffer full]
├── dataSync5min()
│   ├── getTrackedSymbols()
│   ├── retryWithBackoff()
│   │   └── getStockQuote()
│   └── insertMany()
│       └── flush() [if buffer full]
├── marketDataSync()
│   ├── retryWithBackoff()
│   │   └── getMarketMovers('gainers')
│   ├── sleep(1000)
│   ├── retryWithBackoff()
│   │   └── getMarketMovers('losers')
│   └── insertMany()
│       └── flush() [if buffer full]
├── flushAll()
│   └── flush() [for each table]
├── technicalIndicatorsSync()
│   ├── getLastIndicatorTimestamp()
│   ├── getNewMarketData()
│   ├── getHistoricalPrices()
│   ├── calculateRSI()
│   ├── calculateMACD()
│   ├── calculateEMA()
│   ├── calculateVolatility()
│   └── insertMany()
│       └── flush() [if buffer full]
├── flushAll()
├── aiTradingSystem()
│   ├── getLatestMarketData()
│   ├── getHistoricalPrices()
│   ├── getLatestIndicators()
│   ├── generateAISignal() [3x per symbol]
│   └── insertMany() [2x: results + signals]
└── flushAll()
```

---

## 🎯 Function Responsibilities Summary

| Function | Responsibility | Complexity |
|----------|---------------|------------|
| `runAll()` | Orchestration | Medium |
| `historicalDataSync()` | Data fetching | Low |
| `dataSync5min()` | Data fetching | Low |
| `marketDataSync()` | Data fetching | Low |
| `insertMany()` | Buffering | Low |
| `flush()` | Database insert | Medium |
| `flushAll()` | Batch flushing | Low |
| `technicalIndicatorsSync()` | Indicator calculation | High |
| `aiTradingSystem()` | Strategy evaluation | High |
| `retryWithBackoff()` | Error handling | Medium |
| `getLastIndicatorTimestamp()` | Data query | Low |
| `getNewMarketData()` | Data query | Low |
| `getHistoricalPrices()` | Data query | Low |
| `getLatestIndicators()` | Data query | Low |
| `getLatestMarketData()` | Data query | Low |

---

## 🔍 Function Search Guide

**Need to modify data fetching?**
→ Look in `src/fetch/` modules

**Need to change batch size?**
→ `src/compute/batchWriter.ts` → `BATCH_SIZE` constant

**Need to add new indicator?**
→ `src/compute/technicalIndicators.ts` → `technicalIndicatorsSync()`

**Need to add new strategy?**
→ `src/ai/aiTradingSystem.ts` → `aiTradingSystem()`

**Need to change rate limiting?**
→ `src/utils/rateLimiter.ts` → `retryWithBackoff()` or delays in fetch modules

**Need to change pipeline flow?**
→ `src/index.ts` → `runAll()`

