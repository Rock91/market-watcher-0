# Market Watcher System Overview

## Server Startup Sequence

When the server starts (`npm run dev` or `npm start`), the following services are automatically initialized:

### 1. Core Services
- **Express Server** - HTTP API server
- **WebSocket Server** - Real-time data streaming
- **Price Broadcaster** - Broadcasts prices, movers, AI signals, trending stocks

### 2. Database Services
- **ClickHouse Initialization** - Creates all tables if they don't exist
  - Per-stock tables (AAPL_quotes, AAPL_historical, etc.)
  - Shared tables (market_movers, tracked_symbols, technical_indicators, etc.)
  - AI tables (ai_strategy_results, ai_signals, trade_history)

### 3. Background Sync Services (Auto-Started)

#### A. Data Fetcher (`dataFetcher.ts`)
- **Schedule**: 
  - Quotes: Every 1 minute
  - Market Movers: Every 5 minutes
  - Historical Data: Every 30 minutes
  - Trending: Every 10 minutes
- **Purpose**: Fetches and caches popular stock data

#### B. Market Data Sync (`marketDataSync.ts`)
- **Schedule**:
  - Market Movers: Every 60 seconds (1 minute)
  - Historical Backfill: Every 10 minutes
- **Purpose**: 
  - Fetches all market movers (gainers & losers)
  - Updates `tracked_symbols` table
  - Backfills historical data for tracked symbols
  - Fetches stock quotes for all movers

#### C. Technical Indicators Sync (`technicalIndicatorsSync.ts`)
- **Schedule**: Every 60 minutes (1 hour)
- **Purpose**:
  - Calculates RSI, MACD, and Volatility for tracked symbols
  - Stores indicators in `technical_indicators` table

### 4. Manual Services (Not Auto-Started)

#### D. AI Trading System (`aiTradingSystem.ts`)
- **Usage**: `npm run ai:trading` or `npm run ai:trading:once`
- **Schedule**: Every 30 seconds (when running)
- **Purpose**:
  - Runs all AI strategies on all tracked stocks
  - Creates AI signals when confidence > 75%
  - Executes trades automatically
  - Tracks all trades in `trade_history`

## Database Tables

### Per-Stock Tables (Dynamic)
- `{SYMBOL}_quotes` - Real-time quotes for each stock
- `{SYMBOL}_historical` - Historical OHLCV data for each stock

### Shared Tables
- `stock_quotes` - Legacy shared table (being phased out)
- `historical_data` - Legacy shared table (being phased out)
- `market_movers` - Daily gainers and losers
- `tracked_symbols` - Symbols being tracked (from market movers)
- `trending_symbols` - Trending stocks
- `stock_metadata` - Stock information
- `technical_indicators` - RSI, MACD, Volatility data
- `ai_strategy_results` - All AI strategy runs
- `ai_signals` - High confidence signals (>75%)
- `trade_history` - All executed trades
- `script_execution_log` - Script execution tracking

## Data Flow

1. **Market Movers** → `market_movers` table + `tracked_symbols` table
2. **Tracked Symbols** → Historical data backfill → Per-stock tables
3. **Historical Data** → Technical indicators calculation → `technical_indicators` table
4. **AI Strategies** → Strategy results → `ai_strategy_results` table
5. **High Confidence** → AI signals → `ai_signals` table → Trades → `trade_history` table

## Key Functions

### ClickHouse Service (`clickhouse.ts`)
- `initializeClickHouse()` - Creates all tables
- `storeStockQuotes()` - Stores quotes in per-stock tables
- `storeHistoricalData()` - Stores historical data in per-stock tables
- `storeTrackedSymbolsFromMovers()` - Updates tracked_symbols
- `getAllTrackedSymbols()` - Gets all tracked symbols
- `storeTechnicalIndicators()` - Stores RSI/MACD/Volatility
- `storeAIStrategyResult()` - Stores AI strategy runs
- `storeAISignal()` - Stores high confidence signals
- `storeTrade()` - Stores trade history

### Market Data Sync (`marketDataSync.ts`)
- `startMarketDataSync()` - Starts the sync service
- `fetchAllMarketMovers()` - Fetches and stores movers
- `backfillHistoricalData()` - Backfills missing historical data

### Technical Indicators Sync (`technicalIndicatorsSync.ts`)
- `startIndicatorsSync()` - Starts the indicators sync
- Calculates RSI, MACD, Volatility for all tracked symbols

### AI Trading System (`aiTradingSystem.ts`)
- `startAITradingSystem()` - Starts continuous trading
- `runOnce()` - Runs once and exits
- Processes all tracked symbols with all strategies
- Executes trades when confidence > 75%

## Verification

All services are properly linked:
- ✅ All imports are correct
- ✅ All exports are available
- ✅ No linting errors
- ✅ All sync services auto-start on server startup
- ✅ Tracked symbols queries use FINAL for ReplacingMergeTree
- ✅ Error handling in place for all services

## Notes

- `tracked_symbols` uses ReplacingMergeTree, so queries should use `FINAL` to see latest data
- Per-stock tables are created dynamically when data is first stored
- All services gracefully handle ClickHouse unavailability
- Market data sync updates `tracked_symbols` every 60 seconds
