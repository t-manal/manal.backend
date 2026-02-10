import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/app-error';
import { logger } from '../utils/logger';

// =========================================================
// CANONICAL ROLE DEFINITIONS (PHASE 2 - FINAL)
// =========================================================
export const PANEL_ROLES = ['INSTRUCTOR'] as const;
export const STUDENT_ROLES = ['STUDENT'] as const;

export type PanelRole = typeof PANEL_ROLES[number];
export type StudentRole = typeof STUDENT_ROLES[number];

/**
 * Middleware to enforce RBAC based on token role.
 * Backend is the ultimate enforcement (PRIMARY SECURITY).
 */
export const requireRoles = (allowedRoles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return next(new AppError('Unauthorized', 401));
        }

        const userRole = req.user.role;

        // Strict Check: User's role MUST be in the allowed list.
        if (!userRole || !allowedRoles.includes(userRole)) {
            // SECURITY: Log this specific failure for audit
            logger.warn(`RBAC Denial: ${req.user.userId || 'Unknown'} role '${userRole}' not in [${allowedRoles.join(', ')}]`, {
                event: 'RBAC_DENIAL',
                userId: req.user.userId,
                actualRole: userRole,
                requiredRoles: allowedRoles,
                path: req.originalUrl
            });
            
            return next(new AppError('Forbidden: Insufficient permissions', 403));
        }

        next();
    };
};

/**
 * Enforces access for Control Panel Users (Instructors ONLY).
 * Use this for all /api/v1/instructor/** and /api/v1/admin/** routes.
 */
export const requirePanelRole = requireRoles([...PANEL_ROLES]);

/**
 * Enforces access for Students.
 * Use this for all /api/v1/student/** or student-facing routes.
 */
export const requireStudentRole = requireRoles([...STUDENT_ROLES]);

/**
 * Enforces access for ANY authenticated role (Student, Instructor, Admin).
 * Use this for shared resources like asset viewers.
 */
export const requireAnyRole = requireRoles([...PANEL_ROLES, ...STUDENT_ROLES]);


// @deprecated - Use requirePanelRole or requireStudentRole instead
// Kept temporarily to avoid build errors until all routes are updated
export const requireRole = (...roles: string[]) => requireRoles(roles);
