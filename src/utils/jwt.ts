import jwt from 'jsonwebtoken';


const isProduction = process.env.NODE_ENV === 'production';

// In production, we MUST have these set. In Dev, fallbacks are okay for convenience.
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (isProduction && (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET)) {
    throw new Error('FATAL: JWT secrets missing in production environment');
}

// SECURITY: In Production, never use the fallback. In Dev, usage is logged or permitted.
const FINAL_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || (isProduction ? (() => { throw new Error('JWT Access Secret missing'); })() : 'access-secret');
const FINAL_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (isProduction ? (() => { throw new Error('JWT Refresh Secret missing'); })() : 'refresh-secret');

const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export interface TokenPayload {
    // Canonical Fields (Strictly enforced in new tokens)
    userId: string;
    role: string;
}

export class JwtUtils {
    static generateAccessToken(payload: TokenPayload): string {
        return jwt.sign(payload, FINAL_ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN as any });
    }

    static generateRefreshToken(payload: TokenPayload): string {
        return jwt.sign(payload, FINAL_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN as any });
    }

    static verifyAccessToken(token: string): TokenPayload {
        return jwt.verify(token, FINAL_ACCESS_SECRET) as TokenPayload;
    }

    static verifyRefreshToken(token: string): TokenPayload {
        return jwt.verify(token, FINAL_REFRESH_SECRET) as TokenPayload;
    }
}
