# Quick Reference Guide

## 🚀 Common Commands

```bash
# Run the entire pipeline
npm run run:all

# Run backend server
npm run dev

# Run frontend
npm run dev:client

# Run both (separate terminals)
npm run dev          # Terminal 1
npm run dev:client   # Terminal 2
```

## 📁 File Locations

| Component | File Path |
|-----------|-----------|
| Main Pipeline | `src/index.ts` |
| Historical Data | `src/fetch/historicalDataSync.ts` |
| 5-Min Data | `src/fetch/dataSync5min.ts` |
| Market Movers | `src/fetch/marketDataSync.ts` |
| Batch Writer | `src/compute/batchWriter.ts` |
| Indicators | `src/compute/technicalIndicators.ts` |
| AI System | `src/ai/aiTradingSystem.ts` |
| Logger | `src/utils/logger.ts` |
| Rate Limiter | `src/utils/rateLimiter.ts` |

## 🔧 Quick Modifications

### Change Batch Size
**File**: `src/compute/batchWriter.ts`
```typescript
const BATCH_SIZE = 2000; // Change from 1000 to 2000
```

### Change Date Range
**File**: `src/fetch/historicalDataSync.ts`
```typescript
startDate.setDate(startDate.getDate() - 60); // 60 days instead of 30
```

### Change Delay Between Requests
**File**: `src/fetch/dataSync5min.ts`
```typescript
await sleep(500); // 500ms instead of 200ms
```

### Add New Strategy
**File**: `src/ai/aiTradingSystem.ts`
```typescript
const strategies = ['neuro-scalp', 'deep-momentum', 'sentiment-flow', 'your-strategy'];
```

### Change Confidence Threshold
**File**: `src/ai/aiTradingSystem.ts`
```typescript
if (signal.confidence > 80) { // 80% instead of 75%
```

## 📊 Database Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `ai_strategy_results` | All strategy evaluations | timestamp, symbol, strategy, action, confidence, price |
| `technical_indicators` | Calculated indicators | date, symbol, rsi, macd_value, volatility |
| `ai_signals` | High-confidence signals | signal_id, symbol, strategy, confidence, status |

## 🔍 Common Queries

```sql
-- Recent strategy results
SELECT * FROM market_data.ai_strategy_results 
WHERE timestamp >= now() - INTERVAL 1 HOUR
ORDER BY timestamp DESC LIMIT 100;

-- High-confidence signals
SELECT * FROM market_data.ai_signals
WHERE confidence > 75 AND status = 'pending'
ORDER BY confidence DESC;

-- Latest indicators for symbol
SELECT * FROM market_data.technical_indicators
WHERE symbol = 'AAPL'
ORDER BY date DESC LIMIT 1;
```

## 🐛 Common Issues & Fixes

### Rate Limit Errors (429)
**Fix**: Increase delays in fetch modules
```typescript
await sleep(1000); // Increase from 200ms to 1000ms
```

### Table Not Found
**Fix**: Ensure initialization runs first
```typescript
await initializeClickHouse(); // Must run before any queries
```

### Missing Data
**Fix**: Check tracked symbols exist
```sql
SELECT COUNT(*) FROM market_data.tracked_symbols;
```

### Slow Performance
**Fix**: Increase batch size
```typescript
const BATCH_SIZE = 2000; // Larger batches = fewer inserts
```

## 📝 Function Signatures

### Batch Writer
```typescript
insertMany(rows: any[], tableName: string): Promise<void>
flush(tableName: string): Promise<void>
flushAll(): Promise<void>
```

### Rate Limiter
```typescript
sleep(ms: number): Promise<void>
retryWithBackoff<T>(fn: () => Promise<T>, maxRetries?: number, baseDelay?: number): Promise<T>
```

### Logger
```typescript
log(msg: string): void
```

## 🔄 Data Flow Summary

```
1. Initialize DB → Create tables
2. Fetch Data → Yahoo Finance API (parallel)
3. Buffer Data → In-memory (1000 rows)
4. Flush to DB → ClickHouse bulk insert
5. Calculate Indicators → Incremental processing
6. Evaluate Strategies → AI trading system
7. Generate Signals → High-confidence trades
```

## 🎯 Key Concepts

- **Incremental Processing**: Only processes new data since last run
- **Batch Writing**: Groups inserts for efficiency (1000 rows)
- **Rate Limiting**: Prevents API throttling with delays and retries
- **Parallel Execution**: Multiple data sources fetched simultaneously
- **Error Resilience**: Continues even if one module fails

## 📚 Related Documentation

- Full Documentation: `src/README.md`
- Architecture: `src/ARCHITECTURE.md`
- This Guide: `src/QUICK_REFERENCE.md`

