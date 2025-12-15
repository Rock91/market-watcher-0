import { Router } from 'express';
import {
  getMarketMoversController,
  getTrendingSymbolsController,
  getMarketMoversHistoryController
} from '../controllers/marketController';

const router = Router();

// Get market movers (gainers/losers)
router.get('/movers/:type', getMarketMoversController);

// Get trending symbols
router.get('/trending', getTrendingSymbolsController);

// Get historical market movers from ClickHouse
router.get('/movers/history-clickhouse', getMarketMoversHistoryController);

export default router;