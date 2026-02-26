import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { registerSchema, loginSchema, updateProfileSchema, changePasswordSchema, verifyEmailSchema, resendCodeSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.schema';
import { ApiResponse } from '../../utils/api-response';

const authService = new AuthService();

/**
 * SECURITY: Centralized Refresh Cookie Configuration
 * 
 * - HttpOnly: Prevents JavaScript access (XSS protection)
 * - Secure: Only sent over HTTPS in production
 * - SameSite: 'strict' in production for CSRF protection
 * - Path: Restricted to /api/v1/auth/refresh to minimize exposure
 */
const REFRESH_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Must be true if sameSite='none'
    // SECURITY CRITICAL: Vercel (frontend) and Railway (backend) are different origins.
    // We MUST use 'none' to allow the cookie to be sent cross-site.
    // 'strict' would BLOCK the cookie because the domains don't match.
    sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
    path: '/api/v1/auth/refresh',
    maxAge: 7 * 24 * 60 * 60 * 1000,
};

export class AuthController {
    async register(req: Request, res: Response, next: NextFunction) {
        try {
            // SECURITY: Explicit check to prevent privilege escalation
            // Users MUST NOT be able to set their own role via API
            if ('role' in req.body) {
                return ApiResponse.error(res, null, 'Invalid field: role cannot be set during registration', 400);
            }

            const input = registerSchema.parse(req.body);
            const { accessToken, refreshToken } = await authService.register(
                input, 
                req.ip || req.socket.remoteAddress, 
                req.headers['user-agent']
            );

            // SECURITY: Set refresh token with hardened cookie options
            res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

            return ApiResponse.success(res, { accessToken }, 'User registered successfully', 201);
        } catch (error) {
            next(error);
        }
    }

    async login(req: Request, res: Response, next: NextFunction) {
        try {
            const input = loginSchema.parse(req.body);
            const { accessToken, refreshToken, user } = await authService.login(
                input,
                req.ip || req.socket.remoteAddress,
                req.headers['user-agent']
            );

            // SECURITY: Set refresh token with hardened cookie options
            res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

            return ApiResponse.success(res, { accessToken, user }, 'Logged in successfully');
        } catch (error) {
            next(error);
        }
    }

    async refresh(req: Request, res: Response, next: NextFunction) {
        try {
            const refreshToken = req.cookies.refreshToken;
            if (!refreshToken) {
                // SECURITY: Clear cookie to prevent infinite refresh loops on frontend
                res.clearCookie('refreshToken', { 
                    path: REFRESH_COOKIE_OPTIONS.path,
                    httpOnly: true,
                    secure: REFRESH_COOKIE_OPTIONS.secure,
                    sameSite: REFRESH_COOKIE_OPTIONS.sameSite
                });
                return res.status(401).json({ success: false, message: 'Refresh token missing' });
            }

            const { accessToken, refreshToken: newRefreshToken } = await authService.refreshTokens(
                refreshToken,
                req.ip || req.socket.remoteAddress,
                req.headers['user-agent']
            );

            // SECURITY: Rotate refresh token with hardened cookie options
            res.cookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTIONS);

            return ApiResponse.success(res, { accessToken }, 'Token refreshed successfully');
        } catch (error) {
            // If refresh fails (e.g. revoked), clear the cookie
            res.clearCookie('refreshToken', { 
                path: REFRESH_COOKIE_OPTIONS.path,
                httpOnly: true,
                secure: REFRESH_COOKIE_OPTIONS.secure,
                sameSite: REFRESH_COOKIE_OPTIONS.sameSite
            });
            next(error);
        }
    }

    async logout(req: Request, res: Response, next: NextFunction) {
        try {
            if (req.user) {
                await authService.logout(req.user.userId);
            }
            // SECURITY: Clear cookie with matching path
            res.clearCookie('refreshToken', { 
                path: REFRESH_COOKIE_OPTIONS.path,
                httpOnly: true,
                secure: REFRESH_COOKIE_OPTIONS.secure,
                sameSite: REFRESH_COOKIE_OPTIONS.sameSite
            });
            return ApiResponse.success(res, null, 'Logged out successfully');
        } catch (error) {
            next(error);
        }
    }

    async me(req: Request, res: Response, next: NextFunction) {
        try {
            const user = await authService.getMe(req.user!.userId);
            return ApiResponse.success(res, user, 'Current user profile fetched');
        } catch (error) {
            next(error);
        }
    }

    async updateProfile(req: Request, res: Response, next: NextFunction) {
        try {
            const input = updateProfileSchema.parse(req.body);
            const user = await authService.updateProfile(req.user!.userId, input);
            return ApiResponse.success(res, user, 'Profile updated successfully');
        } catch (error) {
            next(error);
        }
    }

    async changePassword(req: Request, res: Response, next: NextFunction) {
        try {
            const input = changePasswordSchema.parse(req.body);
            await authService.changePassword(req.user!.userId, input);
            return ApiResponse.success(res, null, 'Password changed successfully');
        } catch (error) {
            next(error);
        }
    }

    async verifyEmail(req: Request, res: Response, next: NextFunction) {
        try {
            const { code } = verifyEmailSchema.parse(req.body);
            await authService.verifyEmail(req.user!.userId, code);
            return ApiResponse.success(res, null, 'Email verified successfully');
        } catch (error) {
            next(error);
        }
    }

    async resendVerification(req: Request, res: Response, next: NextFunction) {
        try {
            const { email } = resendCodeSchema.parse(req.body);
            const result = await authService.sendVerificationCode(req.user!.userId, email);
            
            if (!result.success) {
                return ApiResponse.error(res, null, result.error || 'Failed to send verification email', 503);
            }

            return ApiResponse.success(res, { messageId: result.messageId }, 'Verification code resent successfully');
        } catch (error) {
            next(error);
        }
    }
    

    async forgotPassword(req: Request, res: Response, next: NextFunction) {
        try {
            const { email } = forgotPasswordSchema.parse(req.body);
            const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
            const proto = forwardedProto || req.protocol || 'https';
            const host = req.get('host');
            const apiBaseUrl = host ? `${proto}://${host}/api/v1` : undefined;
            await authService.requestPasswordReset(email, { apiBaseUrl });
            return ApiResponse.success(res, null, 'If an account exists for this email, we have sent a reset link.');
        } catch (error) {
            next(error);
        }
    }

    async resetPassword(req: Request, res: Response, next: NextFunction) {
        try {
            const { token, newPassword } = resetPasswordSchema.parse(req.body);
            await authService.resetPassword(token, newPassword);
            return ApiResponse.success(res, null, 'Password reset successfully');
        } catch (error) {
            next(error);
        }
    }
}
