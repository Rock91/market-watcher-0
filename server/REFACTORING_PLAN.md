# Code Structure Refactoring Plan

## Goal
Reorganize codebase into smaller, focused modules that are easy to understand and track.

## Current Issues
1. **Large files**: `clickhouse.ts` is 1679 lines - too large to maintain
2. **Mixed concerns**: Database operations, business logic, and data transformation are mixed
3. **Unclear dependencies**: Hard to see what depends on what
4. **Hard to track**: Large files make it difficult to find specific functionality

## New Structure

```
server/
├── database/              # Database layer (NEW)
│   ├── client.ts         # Database connection
│   ├── utils.ts          # Database utilities
│   ├── tables/           # Table schema definitions
│   │   ├── stock.ts      # Stock data tables
│   │   ├── market.ts     # Market data tables
│   │   ├── indicators.ts # Technical indicators tables
│   │   ├── ai.ts         # AI trading tables
│   │   └── system.ts     # System tables
│   ├── operations/       # Database operations (NEW)
│   │   ├── stock.ts      # Stock data operations
│   │   ├── market.ts     # Market data operations
│   │   ├── indicators.ts # Indicators operations
│   │   ├── ai.ts         # AI operations
│   │   └── system.ts     # System operations
│   └── index.ts          # Central exports
│
├── domain/                # Business logic layer (NEW)
│   ├── stock/            # Stock domain logic
│   │   ├── repository.ts # Stock data access
│   │   └── service.ts    # Stock business logic
│   ├── market/           # Market domain logic
│   ├── indicators/       # Indicators domain logic
│   └── ai/               # AI domain logic
│
├── services/              # External services (KEEP)
│   ├── yahooFinance.ts   # Yahoo Finance API
│   ├── technicalIndicators.ts # Indicator calculations
│   └── ai-strategies.ts  # AI strategies
│
├── api/                   # API layer (KEEP)
│   ├── controllers/      # Request handlers
│   └── routes/           # Route definitions
│
├── jobs/                  # Background jobs (KEEP)
├── scripts/               # Standalone scripts (KEEP)
└── utils/                 # Utilities (KEEP)
```

## Migration Steps

### Phase 1: Database Layer (IN PROGRESS)
- [x] Create `database/client.ts` - Database connection
- [x] Create `database/utils.ts` - Helper functions
- [x] Create `database/tables/` - Table schemas split by domain
- [ ] Create `database/operations/stock.ts` - Stock data operations
- [ ] Create `database/operations/market.ts` - Market data operations
- [ ] Create `database/operations/indicators.ts` - Indicators operations
- [ ] Create `database/operations/ai.ts` - AI operations
- [ ] Create `database/operations/system.ts` - System operations
- [ ] Update all imports to use new structure
- [ ] Remove old `services/clickhouse.ts` file

### Phase 2: Domain Layer (NEXT)
- [ ] Create domain modules for each business area
- [ ] Move business logic from controllers to domain services
- [ ] Create repositories for data access abstraction

### Phase 3: Cleanup
- [ ] Update all imports across codebase
- [ ] Remove unused code
- [ ] Add comprehensive documentation
- [ ] Update tests if any

## Benefits

1. **Smaller files**: Each file < 300 lines, focused on one responsibility
2. **Clear separation**: Database, business logic, and API layers are separate
3. **Easy to find**: Related code is grouped together
4. **Easy to test**: Small modules are easier to unit test
5. **Easy to maintain**: Changes are isolated to specific modules

## File Size Targets

- Database operations: < 200 lines each
- Domain services: < 300 lines each
- Controllers: < 150 lines each
- Utils: < 100 lines each
