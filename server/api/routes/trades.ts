import { Router } from 'express';
import {
  storeTradeController,
  getTradesController,
  getRecentTradesController
} from '../controllers/tradeController';

const router = Router();

// Store a trade
router.post('/', storeTradeController);

// Get trades (with optional filters)
router.get('/', getTradesController);

// Get recent trades (last 24 hours)
router.get('/recent', getRecentTradesController);

export default router;
