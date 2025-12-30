import { Router } from 'express';
import {
  getStockQuoteController,
  getHistoricalDataController,
  getStockHistoryController,
  getTechnicalIndicatorsController,
  getAllStocksController
} from '../controllers/stockController';

const router = Router();

// Get all tracked stocks with their latest quotes
router.get('/all', getAllStocksController);

// Get stock quote
router.get('/:symbol/quote', getStockQuoteController);

// Get historical data
router.get('/:symbol/history', getHistoricalDataController);

// Get historical stock quotes from ClickHouse
router.get('/:symbol/history-clickhouse', getStockHistoryController);

// Get technical indicators (RSI, MACD, Volatility)
router.get('/:symbol/indicators', getTechnicalIndicatorsController);

export default router;