import { Router } from 'express';
import { generateSignalController } from '../controllers/aiController';

const router = Router();

// POST /api/ai/signal - Generate AI trading signal
router.post('/signal', generateSignalController);

export default router;

