
import { Router } from 'express';
import { AdminPurchasesController } from './admin-purchases.controller';
import { DashboardInsightsController } from './dashboard-insights.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requirePanelRole } from '../../middlewares/rbac.middleware';
import { Role } from '@prisma/client';
import { adminActionRateLimiter, paymentRateLimiter } from '../../middlewares/rate-limit.middleware';

const router = Router();
const purchasesController = new AdminPurchasesController();
const insightsController = new DashboardInsightsController();

// All routes require AUTH and ADMIN/INSTRUCTOR role
router.use(authMiddleware);
router.use(requirePanelRole); // Enforces PANEL_ROLES (Instructor + Admin)
router.use(adminActionRateLimiter); // General Admin Rate Limit

router.get('/purchases/pending', purchasesController.listPending);
router.post('/purchases/:enrollmentId/mark-paid', paymentRateLimiter, purchasesController.markPaid);
router.get('/purchases/ledger', purchasesController.listLedger); 
router.put('/purchases/payments/:paymentId', paymentRateLimiter, purchasesController.updatePayment); // NEW: Ledger editing
router.get('/purchases/history/export', purchasesController.exportHistory); // NEW: CSV Export
router.get('/revenue/summary', purchasesController.getRevenueSummary);
router.get('/revenue/timeseries', purchasesController.getRevenueTimeseries); // NEW: Time-series
router.get('/dashboard/insights', insightsController.getInsights);

// Admin Locks
import { AdminLocksController } from './admin-locks.controller';
const locksController = new AdminLocksController();

router.post('/locks/toggle', locksController.toggleLock);
router.get('/locks/:enrollmentId', locksController.getEnrollmentLocks);

// Admin Students Management
import { AdminStudentsController } from './admin-students.controller';
const studentsController = new AdminStudentsController();

router.delete('/students/:studentId', studentsController.deleteStudent);
router.delete('/students', studentsController.deleteAllStudents);
router.delete('/courses/:courseId/enrollments', studentsController.clearCourseEnrollments);

export default router;

