import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { authRateLimiter, refreshRateLimiter } from '../../middlewares/rate-limit.middleware';

const router = Router();
const authController = new AuthController();

router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);
router.post('/refresh', refreshRateLimiter, authController.refresh);
// Logout should be accessible even if access token is expired, to clear cookies
router.post('/logout', authController.logout);
router.get('/me', authMiddleware, authController.me);

router.put('/profile', authMiddleware, authController.updateProfile);
router.post('/change-password', authMiddleware, authController.changePassword);

router.post('/verify-email', authMiddleware, authRateLimiter, authController.verifyEmail);
router.post('/resend-verification', authMiddleware, authRateLimiter, authController.resendVerification);

router.post('/forgot-password', authRateLimiter, authController.forgotPassword);
router.post('/reset-password', authRateLimiter, authController.resetPassword);

export default router;
