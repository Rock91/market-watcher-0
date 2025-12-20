import { Router } from 'express';
import {
  getMarketMoversController,
  getTrendingSymbolsController,
  getMarketMoversHistoryController,
  getMarketStatusController
} from '../controllers/marketController';

const router = Router();

// Get market movers (gainers or losers)
router.get('/movers/:type', getMarketMoversController); // This route should come before the more specific 'history-clickhouse' route

// Get trending symbols
router.get('/trending', getTrendingSymbolsController);

// Get historical market movers from ClickHouse
router.get('/movers/history-clickhouse', getMarketMoversHistoryController);

// Get market status (open/closed)
router.get('/status', getMarketStatusController);

export default router;