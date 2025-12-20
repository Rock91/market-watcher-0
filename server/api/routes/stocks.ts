import { Router } from 'express';
import {
  getStockQuoteController,
  getHistoricalDataController,
  getStockHistoryController,
  getTechnicalIndicatorsController
} from '../controllers/stockController';

const router = Router();

// Get stock quote
router.get('/:symbol/quote', getStockQuoteController);

// Get historical data
router.get('/:symbol/history', getHistoricalDataController);

// Get historical stock quotes from ClickHouse
router.get('/:symbol/history-clickhouse', getStockHistoryController);

// Get technical indicators (RSI, MACD, Volatility)
router.get('/:symbol/indicators', getTechnicalIndicatorsController);

export default router;