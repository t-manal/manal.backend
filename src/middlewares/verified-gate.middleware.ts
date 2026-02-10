import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/app-error';
import prisma from '../config/prisma';

/**
 * Middleware to enforce that the user has verified their email address.
 * Must be used AFTER authMiddleware.
 * 
 * FAIL-SAFE:
 * 1. Uses canonical userId from authMiddleware (guaranteed safe).
 * 2. Fetches fresh { emailVerifiedAt, role } from DB.
 * 3. Syncs req.user.role = db.role (Overrides stale token role).
 */
export const verifiedGate = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user || !req.user.userId) {
            throw new AppError('Authentication required', 401);
        }

        // 1. Fetch fresh status from DB (Single O(1) Query)
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { 
                emailVerifiedAt: true,
                role: true, // Sync role for RBAC
            },
        });

        if (!user || user.emailVerifiedAt === null || user.emailVerifiedAt === undefined) {
            throw new AppError('Email verification required to access this feature', 403);
        }

        // 2. Sync Role to Request Object (Authoritative Source)
        // This ensures RBAC downstream sees the TRUE database role, not stale token claim.
        req.user.role = user.role;

        next();
    } catch (error) {
        next(error);
    }
};
