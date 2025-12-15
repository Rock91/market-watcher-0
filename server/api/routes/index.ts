import { Router } from 'express';
import stockRoutes from './stocks';
import marketRoutes from './market';

const router = Router();

// Mount sub-routes
router.use('/stocks', stockRoutes);
router.use('/market', marketRoutes);

export default router;