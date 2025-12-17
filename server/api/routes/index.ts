import { Router } from 'express';
import stockRoutes from './stocks';
import marketRoutes from './market';
import aiRoutes from './ai';
import adminRoutes from './admin';

const router = Router();

// Mount sub-routes
router.use('/stocks', stockRoutes);
router.use('/market', marketRoutes);
router.use('/ai', aiRoutes);
router.use('/admin', adminRoutes);

export default router;