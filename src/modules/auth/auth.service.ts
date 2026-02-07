import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../../config/prisma';
import { AppError } from '../../utils/app-error';
import { JwtUtils, TokenPayload } from '../../utils/jwt';
import { RegisterInput, LoginInput } from './auth.schema';
import { Role } from '@prisma/client';
import { emailService } from '../../services/email/email.service';

export class AuthService {
    async register(input: RegisterInput) {
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

        // Send verification code asynchronously
        this.sendVerificationCode(user.id, user.email).catch(err => {
            console.error('Failed to send initial verification code:', err);
        });

        return this.generateTokens(user.id, user.role);
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

        return await emailService.sendVerificationCode(email, code);
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

    async login(input: LoginInput) {
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

        const tokens = await this.generateTokens(user.id, user.role);
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

    async refreshTokens(refreshToken: string) {
        try {
            const payload = JwtUtils.verifyRefreshToken(refreshToken);
            const user = await prisma.user.findUnique({
                where: { id: payload.userId },
            });

            if (!user || !user.refreshToken) {
                throw new AppError('Invalid refresh token', 401);
            }

            const isTokenValid = await bcrypt.compare(refreshToken, user.refreshToken);
            if (!isTokenValid) {
                throw new AppError('Invalid refresh token', 401);
            }

            return this.generateTokens(user.id, user.role);
        } catch (error) {
            throw new AppError('Invalid or expired refresh token', 401);
        }
    }

    async logout(userId: string) {
        await prisma.user.update({
            where: { id: userId },
            data: { refreshToken: null },
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
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword }
        });
    }

    private async generateTokens(userId: string, role: string) {
        const payload: TokenPayload = { userId, role };
        const accessToken = JwtUtils.generateAccessToken(payload);
        const refreshToken = JwtUtils.generateRefreshToken(payload);

        // Hash refresh token before saving to DB
        const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { refreshToken: hashedRefreshToken },
        });

        return { accessToken, refreshToken };
    }


    async requestPasswordReset(email: string) {
        const user = await prisma.user.findUnique({ where: { email } });

        // Anti-Enumeration: Return success even if user not found (but don't send email)
        if (!user) {
            // Log for debug but don't expose error
            // logger.info('Password reset requested for non-existent email', { email }); 
            // Commented out to strictly follow "Closed Brain" logging rules if not explicitly allowed? 
            // Actually, safe logging is allowed.
            return;
        }

        // Generate Token
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Store Hashed Token
        await prisma.passwordResetToken.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt,
            },
        });

        // Send Email
        const resetLink = `${process.env.STUDENT_APP_URL || 'http://localhost:3000'}/ar/reset-password?token=${token}`;
        await emailService.sendPasswordResetEmail(user.email, resetLink);
    }

    async resetPassword(token: string, newPassword: string) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

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
            // Invalidate all existing sessions (optional but good security practice - 
            // adhering to "revoke token" logic might strictly mean clearing refresh token)
            // Contract says: "Strictly resets the password hash." doesn't mandate logout.
            // Leaving logout out to strictly follow spec "DOES NOT log the user in automatically".
        ]);
    }
}
