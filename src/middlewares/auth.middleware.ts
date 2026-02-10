import { Request, Response, NextFunction } from 'express';
import { JwtUtils, TokenPayload } from '../utils/jwt';
import { AppError } from '../utils/app-error';

declare global {
    namespace Express {
        interface Request {
            user?: TokenPayload;
        }
    }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    try {
        let token = '';
        const authHeader = req.headers.authorization;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        } else if (req.query.token) {
            // SECURITY HARDENING: Only allow token in query for asset endpoints
            const allowedAssetPatterns = [
                /\/api\/v1\/lessons\/.*\/pdf/i,
                /\/api\/v1\/lessons\/.*\/pptx/i,
                /\/api\/v1\/lessons\/.*\/pages/i
            ];
            
            const isAssetRequest = allowedAssetPatterns.some(pattern => pattern.test(req.originalUrl));
            
            if (isAssetRequest) {
                token = req.query.token as string;
            } else {
                throw new AppError('Token in query is only allowed for asset requests', 403);
            }
        }

        if (!token) {
            throw new AppError('Authentication token missing or invalid', 401);
        }

        // VERIFY: Raw decode first to handle potential legacy fields
        const rawPayload = JwtUtils.verifyAccessToken(token) as any;

        // NORMALIZE: Extract canonical userId from userId || id || sub
        const userId = rawPayload.userId || rawPayload.id || rawPayload.sub;

        if (!userId) {
            throw new AppError('Invalid token: User identity missing', 401);
        }

        // STRICT ASSIGNMENT: Create a fresh object matching TokenPayload interface exactly
        // This isolates legacy token handling to this single point in the codebase.
        req.user = {
            userId: userId as string,
            role: (rawPayload.role as string) || '', // Default to empty, validated by RBAC/VerifiedGate
        };

        next();
    } catch (error) {
        const message = error instanceof AppError ? error.message : 'Invalid or expired access token';
        const status = error instanceof AppError ? error.statusCode : 401;
        next(new AppError(message, status));
    }
};
