import { Router } from 'express';
import stockRoutes from './stocks';
import marketRoutes from './market';
import aiRoutes from './ai';
import adminRoutes from './admin';
import tradeRoutes from './trades';

const router = Router();

// Mount sub-routes
router.use('/stocks', stockRoutes);
router.use('/market', marketRoutes);
router.use('/ai', aiRoutes);
router.use('/admin', adminRoutes);
router.use('/trades', tradeRoutes);

export default router;