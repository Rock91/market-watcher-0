import { Router } from 'express';
import {
  getMarketMoversController,
  getTrendingSymbolsController,
  getMarketMoversHistoryController,
  getMarketStatusController,
  getAllMarketsStatusController,
  getStocksFromOpenMarketsController
} from '../controllers/marketController';

const router = Router();

// Get market movers (gainers or losers)
router.get('/movers/:type', getMarketMoversController); // This route should come before the more specific 'history-clickhouse' route

// Get trending symbols
router.get('/trending', getTrendingSymbolsController);

// Get historical market movers from ClickHouse
router.get('/movers/history-clickhouse', getMarketMoversHistoryController);

// Get market status (open/closed) - supports optional ?market=US query param
router.get('/status', getMarketStatusController);

// Get all markets status
router.get('/status/all', getAllMarketsStatusController);

// Get stocks from markets that are currently open
router.get('/open-markets/stocks', getStocksFromOpenMarketsController);

export default router;