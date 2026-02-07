import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { registerSchema, loginSchema, updateProfileSchema, changePasswordSchema, verifyEmailSchema, resendCodeSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.schema';
import { ApiResponse } from '../../utils/api-response';

const authService = new AuthService();

export class AuthController {
    async register(req: Request, res: Response, next: NextFunction) {
        try {
            // SECURITY: Explicit check to prevent privilege escalation
            // Users MUST NOT be able to set their own role via API
            if ('role' in req.body) {
                return ApiResponse.error(res, null, 'Invalid field: role cannot be set during registration', 400);
            }

            const input = registerSchema.parse(req.body);
            const { accessToken, refreshToken } = await authService.register(input);

            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            });

            return ApiResponse.success(res, { accessToken }, 'User registered successfully', 201);
        } catch (error) {
            next(error);
        }
    }

    async login(req: Request, res: Response, next: NextFunction) {
        try {
            const input = loginSchema.parse(req.body);
            const { accessToken, refreshToken, user } = await authService.login(input);

            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            return ApiResponse.success(res, { accessToken, user }, 'Logged in successfully');
        } catch (error) {
            next(error);
        }
    }

    async refresh(req: Request, res: Response, next: NextFunction) {
        try {
            const refreshToken = req.cookies.refreshToken;
            if (!refreshToken) {
                return res.status(401).json({ success: false, message: 'Refresh token missing' });
            }

            const { accessToken, refreshToken: newRefreshToken } = await authService.refreshTokens(refreshToken);

            res.cookie('refreshToken', newRefreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            return ApiResponse.success(res, { accessToken }, 'Token refreshed successfully');
        } catch (error) {
            next(error);
        }
    }

    async logout(req: Request, res: Response, next: NextFunction) {
        try {
            if (req.user) {
                await authService.logout(req.user.userId);
            }
            res.clearCookie('refreshToken');
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
            await authService.requestPasswordReset(email);
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
