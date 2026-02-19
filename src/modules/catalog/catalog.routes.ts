import { Router } from 'express';
import multer from 'multer';
import { CatalogController } from './catalog.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requirePanelRole } from '../../middlewares/rbac.middleware';
import { publicRateLimiter } from '../../middlewares/rate-limit.middleware';
import { Role } from '@prisma/client';
import { UPLOAD_LIMITS } from '../../config/upload-limits.config';

// Phase 8: V2 Simplified Catalog Routes
// Major/Subject routes REMOVED - Direct University → Course flow

const router = Router();
const catalogController = new CatalogController();

// Public Routes (Protected by public rate limiter)
router.get('/universities', publicRateLimiter, (req, res, next) => catalogController.getUniversities(req, res, next));
router.get('/universities/:id', publicRateLimiter, (req, res, next) => catalogController.getUniversity(req, res, next));

// V2: Direct University → Courses (replaces Major/Subject hierarchy)
router.get('/universities/:id/courses', authMiddleware, requirePanelRole, (req, res, next) => catalogController.getUniversityCourses(req, res, next)); // Admin - includes drafts
router.get('/universities/:id/public-courses', publicRateLimiter, (req, res, next) => catalogController.getUniversityPublicCourses(req, res, next)); // Public - published only

// Course Routes
router.get('/courses', publicRateLimiter, (req, res, next) => catalogController.getCourses(req, res, next));
router.get('/courses/:id', publicRateLimiter, (req, res, next) => catalogController.getCourse(req, res, next));

// Protected Routes (Admin/Instructor Management)
router.post('/universities', authMiddleware, requirePanelRole, (req, res, next) => catalogController.createUniversity(req, res, next));
router.delete('/universities/:id', authMiddleware, requirePanelRole, (req, res, next) => catalogController.deleteUniversity(req, res, next));

// Logo Management
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_LIMITS.LOGO } // POLICY: 2MB centralized
});

router.post(
    '/universities/:id/logo',
    authMiddleware,
    requirePanelRole,
    upload.single('file'),
    (req, res, next) => catalogController.uploadUniversityLogo(req, res, next)
);

router.delete(
    '/universities/:id/logo',
    authMiddleware,
    requirePanelRole,
    (req, res, next) => catalogController.deleteUniversityLogo(req, res, next)
);

export default router;
