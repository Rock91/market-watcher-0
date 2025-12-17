import { Router } from 'express';
import { getClickhouseHealthController } from '../controllers/adminController';

const router = Router();

// GET /api/admin/clickhouse/health
router.get('/clickhouse/health', getClickhouseHealthController);

export default router;


