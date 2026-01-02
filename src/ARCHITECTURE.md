# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Pipeline Entry Point                     │
│                          src/index.ts                            │
│  - Orchestrates all steps                                        │
│  - Handles errors gracefully                                     │
│  - Manages execution flow                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Step 0: Database Initialization              │
│  - Creates database if not exists                               │
│  - Creates all required tables                                  │
│  - Sets up indexes and partitions                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Step 1: Parallel Data Fetching (3 modules)          │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐│
│  │ Historical Data  │  │   5-Min Data     │  │ Market Movers││
│  │   Sync Module    │  │    Sync Module   │  │  Sync Module ││
│  │                  │  │                  │  │              ││
│  │ - 30-day history │  │ - Current quotes │  │ - Top 20     ││
│  │ - All symbols    │  │ - All symbols    │  │ - Gainers    ││
│  │ - Daily interval │  │ - 5-min snapshots│  │ - Losers     ││
│  └──────────────────┘  └──────────────────┘  └──────────────┘│
│         │                      │                      │          │
│         └──────────────────────┴──────────────────────┘          │
│                            │                                    │
│                            ▼                                    │
│              ┌─────────────────────────┐                        │
│              │   Batch Writer Buffer   │                        │
│              │  (1000 rows per batch)  │                        │
│              └─────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Step 2: Flush to ClickHouse                        │
│  - WSL-safe bulk insert                                        │
│  - Handles date conversions                                     │
│  - Error recovery with buffer restoration                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         Step 3: Technical Indicators Calculation                │
│                                                                  │
│  For each symbol:                                               │
│    1. Get last calculated timestamp                             │
│    2. Fetch new data since last calculation                     │
│    3. Get historical prices (50 days)                          │
│    4. Calculate:                                                │
│       - RSI (14 period)                                         │
│       - MACD (12/26/9)                                          │
│       - SMA20, SMA50                                            │
│       - EMA12, EMA26                                            │
│       - Volatility                                              │
│    5. Insert indicators                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Step 4: AI Trading System                          │
│                                                                  │
│  For each symbol with fresh indicators:                         │
│    1. Get latest market data                                    │
│    2. Get historical prices                                     │
│    3. Get latest indicators                                     │
│    4. Evaluate 3 strategies:                                    │
│       - neuro-scalp (high-frequency)                            │
│       - deep-momentum (trend following)                         │
│       - sentiment-flow (sentiment-based)                        │
│    5. Store all results                                         │
│    6. Create signals for high-confidence (>75%)                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
Yahoo Finance API
       │
       ├─── Historical Data ────┐
       ├─── Current Quotes ─────┤
       └─── Market Movers ───────┤
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │  Fetch Modules      │
                    │  (with rate limit)  │
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │  Batch Writer       │
                    │  (Buffer: 1000)    │
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │  ClickHouse         │
                    │  ai_strategy_results│
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │  Technical          │
                    │  Indicators Calc    │
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │  ClickHouse         │
                    │  technical_indicators│
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │  AI Trading System  │
                    │  (3 strategies)    │
                    └─────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
        ┌──────────────────┐    ┌──────────────────┐
        │ ai_strategy_     │    │ ai_signals       │
        │ results          │    │ (>75% confidence)│
        └──────────────────┘    └──────────────────┘
```

## Module Dependencies

```
index.ts
  ├── initializeClickHouse (server/database/tables)
  ├── historicalDataSync
  │     ├── getTrackedSymbols (server/services/clickhouse)
  │     ├── getHistoricalData (server/services/yahooFinance)
  │     └── insertMany (batchWriter)
  ├── dataSync5min
  │     ├── getTrackedSymbols (server/services/clickhouse)
  │     ├── getStockQuote (server/services/yahooFinance)
  │     └── insertMany (batchWriter)
  ├── marketDataSync
  │     ├── getMarketMovers (server/services/yahooFinance)
  │     └── insertMany (batchWriter)
  ├── technicalIndicatorsSync
  │     ├── clickhouseClient (queries)
  │     ├── calculateRSI, calculateMACD, etc. (server/services/technicalIndicators)
  │     └── insertMany (batchWriter)
  └── aiTradingSystem
        ├── clickhouseClient (queries)
        ├── generateAISignal (server/services/ai-strategies)
        └── insertMany (batchWriter)

batchWriter
  ├── clickhouseClient (server/database/client)
  └── CLICKHOUSE_CONFIG (server/config/database)
```

## Error Handling Strategy

```
┌─────────────────────────────────────────┐
│         API Call (Yahoo Finance)        │
└─────────────────────────────────────────┘
              │
              ▼
    ┌─────────────────────┐
    │  Success?           │
    └─────────────────────┘
         │          │
      Yes│          │No
         │          │
         ▼          ▼
    ┌────────┐  ┌──────────────────┐
    │ Return │  │ Rate Limit (429)?│
    │ Data   │  └──────────────────┘
    └────────┘         │          │
                    Yes│          │No
                       │          │
                       ▼          ▼
              ┌─────────────┐  ┌──────────┐
              │ Wait & Retry│  │ Log Error │
              │ (exponential│  │ Continue │
              │  backoff)   │  │          │
              └─────────────┘  └──────────┘
                       │
                       ▼
              ┌─────────────┐
              │ Max Retries? │
              └─────────────┘
                   │      │
                 No│      │Yes
                   │      │
                   ▼      ▼
              ┌─────┐  ┌──────────┐
              │Retry│  │Log Error │
              │     │  │Continue  │
              └─────┘  └──────────┘
```

## Rate Limiting Strategy

```
Request 1 ──┐
            │
Request 2 ──┼── 500ms delay ──┐
            │                  │
Request 3 ──┼── 1000ms delay ──┼── Execute in parallel
            │                  │
            │                  │
            ▼                  ▼
    ┌──────────────┐    ┌──────────────┐
    │ 200ms delay  │    │ 300ms delay  │
    │ between      │    │ between      │
    │ requests     │    │ requests     │
    └──────────────┘    └──────────────┘
```

## Batch Processing Flow

```
Row 1 ──┐
Row 2 ──┤
Row 3 ──┤
...     ├── Buffer (in-memory)
Row 999─┤
Row 1000┤
        │
        ▼
┌───────────────┐
│ Buffer Full?  │
│ (1000 rows)   │
└───────────────┘
    │      │
  Yes│      │No
    │      │
    ▼      │
┌───────────────┐
│ Flush to DB   │
│ (Bulk Insert) │
└───────────────┘
    │
    ▼
┌───────────────┐
│ Clear Buffer  │
└───────────────┘
```

## Incremental Processing Strategy

```
First Run:
  ┌─────────────────┐
  │ All Data        │
  │ (no timestamp)  │
  └─────────────────┘
         │
         ▼
  ┌─────────────────┐
  │ Process All     │
  └─────────────────┘
         │
         ▼
  ┌─────────────────┐
  │ Store Last TS   │
  └─────────────────┘

Subsequent Runs:
  ┌─────────────────┐
  │ Get Last TS     │
  └─────────────────┘
         │
         ▼
  ┌─────────────────┐
  │ Query:          │
  │ WHERE ts > last │
  └─────────────────┘
         │
         ▼
  ┌─────────────────┐
  │ Process Only    │
  │ New Data        │
  └─────────────────┘
         │
         ▼
  ┌─────────────────┐
  │ Update Last TS  │
  └─────────────────┘
```

## Performance Optimizations

1. **Parallel Fetching**: Three data sources fetched simultaneously
2. **Batch Inserts**: 1000 rows per insert (reduces overhead)
3. **Incremental Processing**: Only processes new data
4. **Staggered Execution**: Delays prevent simultaneous rate limits
5. **Connection Pooling**: ClickHouse client manages connections
6. **Indexed Queries**: Bloom filters and minmax indexes for fast lookups

## Scalability Considerations

- **Horizontal Scaling**: Each module can run independently
- **Vertical Scaling**: Increase batch sizes and parallel workers
- **Database Partitioning**: Tables partitioned by month for efficient queries
- **TTL Management**: Automatic data cleanup after retention period

