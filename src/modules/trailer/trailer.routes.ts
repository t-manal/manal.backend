import { Router } from 'express';
import { TrailerController } from './trailer.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requirePanelRole } from '../../middlewares/rbac.middleware';
import { verifiedGate } from '../../middlewares/verified-gate.middleware';

const router = Router();
const controller = new TrailerController();

// Instructor routes (admin panel)
router.get('/instructor/courses/:courseId/trailer', authMiddleware, requirePanelRole, controller.getConfig);
router.patch('/instructor/courses/:courseId/trailer', authMiddleware, requirePanelRole, controller.updateConfig);

// Student route (verified email required)
router.get('/courses/:courseId/trailer', authMiddleware, verifiedGate, controller.getStudentTrailer);

export default router;
