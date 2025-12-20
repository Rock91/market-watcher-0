import { Router } from 'express';
import { 
  getClickhouseHealthController,
  getScriptExecutionHistoryController,
  getLatestScriptExecutionController
} from '../controllers/adminController';

const router = Router();

// GET /api/admin/clickhouse/health
router.get('/clickhouse/health', getClickhouseHealthController);

// GET /api/admin/scripts/history - Get script execution history
router.get('/scripts/history', getScriptExecutionHistoryController);

// GET /api/admin/scripts/:script_name/latest - Get latest execution for a specific script
router.get('/scripts/:script_name/latest', getLatestScriptExecutionController);

export default router;


