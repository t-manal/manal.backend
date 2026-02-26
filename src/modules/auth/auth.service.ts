import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../../config/prisma';
import { AppError } from '../../utils/app-error';
import { JwtUtils, TokenPayload } from '../../utils/jwt';
import { RegisterInput, LoginInput } from './auth.schema';
import { Role } from '@prisma/client';
import { emailService } from '../../services/email/email.service';

export class AuthService {
    async register(input: RegisterInput, ipAddress?: string, userAgent?: string) {
        const existingUser = await prisma.user.findFirst({
            where: { email: input.email },
        });

        if (existingUser) {
            throw new AppError('User with this email already exists', 409);
        }

        const username = await this.generateUsername(input.email);
        const hashedPassword = await bcrypt.hash(input.password, 10);

        const user = await prisma.user.create({
            data: {
                email: input.email,
                password: hashedPassword,
                username,
                firstName: input.firstName,
                lastName: input.lastName,
                phoneNumber: input.phoneNumber,
                // SECURITY FIX: ALWAYS force role to STUDENT for public registration
                // ADMIN accounts MUST be created manually via script or SQL
                // This prevents privilege escalation attacks
                role: Role.STUDENT,
            },
        });

        // Send verification code (Awaited for reliability)
        // We catch errors so registration succeeds even if email fails (Token is returned)
        try {
            const emailResult = await this.sendVerificationCode(user.id, user.email);
            if (!emailResult.success) {
                 // Log is already handled inside sendVerificationCode
            }
        } catch (error) {
             const { logger } = await import('../../utils/logger');
             logger.error('CRITICAL: Failed to send initial verification code during registration', { 
                 userId: user.id, 
                 error 
             });
        }

        return this.generateTokens(user.id, user.role, ipAddress, userAgent);
    }

    // RELIABILITY FIX: Fail-fast username generation (Fix #5)
    private async generateUsername(email: string): Promise<string> {
        const prefix = email.split('@')[0].replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
        
        // Generate random 4-digit suffix (0000-9999)
        const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const username = `${prefix}${randomSuffix}`;
        
        // Single uniqueness check
        const existing = await prisma.user.findUnique({
            where: { username },
        });

        if (existing) {
            // Fail fast - extremely rare collision
            throw new AppError(
                'Username generation collision. Please try again.',
                500
            );
        }

        return username;
    }

    async sendVerificationCode(userId: string, email: string) {
        const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Invalidate previous codes
        await prisma.verificationCode.deleteMany({
            where: { userId },
        });

        await prisma.verificationCode.create({
            data: {
                userId,
                codeHash,
                expiresAt,
            },
        });

        // DIAGNOSTIC LOGGING
        const { logger } = await import('../../utils/logger');
        logger.info('Attempting to send verification code', { 
            userId, 
            email: email.replace(/(.{2})(.*)(@.*)/, '$1***$3'),
            route: 'sendVerificationCode' 
        });

        const result = await emailService.sendVerificationCode(email, code);

        if (!result.success) {
             logger.error('Failed to send verification email via EmailService', {
                 userId,
                 error: result.error
             });
        } else {
             logger.info('Verification email sent successfully', { userId, messageId: result.messageId });
        }

        return result;
    }

    async verifyEmail(userId: string, code: string) {
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        
        const verificationRecord = await prisma.verificationCode.findFirst({
            where: {
                userId,
                codeHash,
                expiresAt: { gt: new Date() },
            },
        });

        if (!verificationRecord) {
            throw new AppError('Invalid or expired verification code', 400);
        }

        await prisma.user.update({
            where: { id: userId },
            data: { emailVerifiedAt: new Date() },
        });

        await prisma.verificationCode.delete({
            where: { id: verificationRecord.id },
        });
    }

    async login(input: LoginInput, ipAddress?: string, userAgent?: string) {
        const user = await prisma.user.findUnique({
            where: { email: input.email },
        });

        if (!user || !user.password) {
            throw new AppError('Invalid email or password', 401);
        }

        const isPasswordValid = await bcrypt.compare(input.password, user.password);
        if (!isPasswordValid) {
            throw new AppError('Invalid email or password', 401);
        }

        const tokens = await this.generateTokens(user.id, user.role, ipAddress, userAgent);
        return {
            ...tokens,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
                firstName: user.firstName,
                lastName: user.lastName,
                phoneNumber: user.phoneNumber,
            }
        };
    }

    async refreshTokens(refreshToken: string, ipAddress?: string, userAgent?: string) {
        try {
            const payload = JwtUtils.verifyRefreshToken(refreshToken);
            
            // 1. Verify Token exists in DB and is not revoked
            const storedToken = await prisma.refreshToken.findFirst({
                where: { 
                    token: refreshToken,
                    userId: payload.userId,
                    revokedAt: null,
                    expiresAt: { gt: new Date() }
                },
                include: { user: true }
            });

            if (!storedToken) {
                // Reuse Detection Logic could go here (if a revoked token is used)
                throw new AppError('Invalid refresh token', 401);
            }

            const user = storedToken.user;

            // 2. Rotate Token (Revoke old, issue new)
            // Revoke current
            await prisma.refreshToken.update({
                where: { id: storedToken.id },
                data: { revokedAt: new Date() }
            });

            // Issue new
            return this.generateTokens(user.id, user.role, ipAddress, userAgent);

        } catch (error) {
            throw new AppError('Invalid or expired refresh token', 401);
        }
    }

    async logout(userId: string) {
        // Revoke ALL active refresh tokens for this user
        // This is a secure default. 
        // Ideally we'd only revoke the specific session if we had the token, 
        // but the controller might only give us userId in some flows.
        // If we want specific token revocation, we need the token passed here.
        
        // For now, adhere to previous contract behavior: Global Logout
        await prisma.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() }
        });
        
        // Also clear legacy field just in case
        await prisma.user.update({
            where: { id: userId },
            data: { refreshToken: null }
        });
    }

    async getMe(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                username: true,
                role: true,
                firstName: true,
                lastName: true,
                phoneNumber: true,
            },
        });

        if (!user) {
            throw new AppError('User not found', 404);
        }

        return user;
    }

    async updateProfile(userId: string, data: { firstName: string; lastName: string; phoneNumber?: string }) {
        return prisma.user.update({
            where: { id: userId },
            data: {
                firstName: data.firstName,
                lastName: data.lastName,
                phoneNumber: data.phoneNumber,
            },
            select: {
                id: true,
                email: true,
                username: true,
                role: true,
                firstName: true,
                lastName: true,
                phoneNumber: true,
            }
        });
    }

    async changePassword(userId: string, data: any) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.password) throw new AppError('User not found', 404);

        const isValid = await bcrypt.compare(data.currentPassword, user.password);
        if (!isValid) throw new AppError('Invalid current password', 400);

        const hashedPassword = await bcrypt.hash(data.newPassword, 10);
        
        // Revoke all sessions on password change
        await prisma.$transaction([
            prisma.user.update({
                where: { id: userId },
                data: { password: hashedPassword, refreshToken: null } // Clear legacy
            }),
            prisma.refreshToken.updateMany({
                where: { userId, revokedAt: null },
                data: { revokedAt: new Date() }
            })
        ]);
    }

    private async generateTokens(userId: string, role: string, ipAddress?: string, userAgent?: string) {
        const payload: TokenPayload = { userId, role };
        const accessToken = JwtUtils.generateAccessToken(payload);
        const refreshToken = JwtUtils.generateRefreshToken(payload);

        // Store REFRESH TOKEN in DB
        // Determine expiry (should match JWT expiry)
        // Typically 7 days for refresh token
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); 

        await prisma.refreshToken.create({
            data: {
                userId,
                token: refreshToken,
                expiresAt,
                ipAddress: ipAddress || null,
                deviceInfo: userAgent || null
            }
        });
        
        // Also update legacy field for backward compatibility during migration if needed,
        // but we are moving to new system. Let's keep it null or updated to avoid confusion?
        // Let's update it to the HASH of the new token just in case some old code checks it.
        const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { refreshToken: hashedRefreshToken }
        });

        return { accessToken, refreshToken };
    }

    async requestPasswordReset(email: string) {
        const user = await prisma.user.findUnique({ where: { email } });

        // Anti-Enumeration: Return success even if user not found (but don't send email)
        if (!user) {
            return;
        }

        // Generate Token
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const ttlMinutes = Math.max(5, Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30));
        const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

        // Store Hashed Token
        await prisma.passwordResetToken.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt,
            },
        });

        // Send Email
        const appUrl = (process.env.STUDENT_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
        const resetLink = `${appUrl}/ar/reset-password?token=${encodeURIComponent(token)}`;
        const emailResult = await emailService.sendPasswordResetEmail(user.email, resetLink);
        if (!emailResult.success) {
            const { logger } = await import('../../utils/logger');
            logger.error('Failed to send password reset email via EmailService', {
                userId: user.id,
                error: emailResult.error
            });
        } else {
            const { logger } = await import('../../utils/logger');
            logger.info('Password reset email sent successfully', {
                userId: user.id,
                expiresAt: expiresAt.toISOString(),
                ttlMinutes
            });
        }
    }

    async resetPassword(token: string, newPassword: string) {
        // Normalize token to tolerate trailing punctuation/spaces from email clients.
        const normalizedToken = token
            .trim()
            .replace(/^[^a-fA-F0-9]+|[^a-fA-F0-9]+$/g, '')
            .toLowerCase();

        if (!/^[a-f0-9]{64}$/.test(normalizedToken)) {
            throw new AppError('Invalid or expired password reset token', 400);
        }

        const tokenHash = crypto.createHash('sha256').update(normalizedToken).digest('hex');

        // Find valid token
        const resetRecord = await prisma.passwordResetToken.findUnique({
            where: { tokenHash },
            include: { user: true },
        });

        if (!resetRecord) {
            throw new AppError('Invalid or expired password reset token', 400);
        }

        if (resetRecord.usedAt || resetRecord.expiresAt < new Date()) {
            throw new AppError('Invalid or expired password reset token', 400);
        }

        // Update Password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // Transaction to ensure atomicity
        await prisma.$transaction([
            prisma.user.update({
                where: { id: resetRecord.userId },
                data: { password: hashedPassword },
            }),
            prisma.passwordResetToken.update({
                where: { id: resetRecord.id },
                data: { usedAt: new Date() },
            }),
            // Revoke all sessions on password reset
            prisma.refreshToken.updateMany({
                where: { userId: resetRecord.userId, revokedAt: null },
                data: { revokedAt: new Date() }
            }),
             prisma.user.update({
                where: { id: resetRecord.userId },
                data: { refreshToken: null }
            }),
        ]);
    }
}
