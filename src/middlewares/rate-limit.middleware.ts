import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';
import { logger } from '../utils/logger';

// Create a dedicated Redis client for rate limiting
const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Helper to create rate limiters
const createLimiter = (prefix: string, windowMs: number, max: number, message: string) => {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: 'draft-7', // Return rate limit info in the `RateLimit-*` headers
        legacyHeaders: false, // Disable the `X-RateLimit-*` headers
        store: new RedisStore({
            // @ts-expect-error - Known type mismatch between ioredis and rate-limit-redis
            sendCommand: (...args: string[]) => redisClient.call(...args),
            prefix: `rate-limit:${prefix}:`
        }),
        keyGenerator: (req) => {
            // Use User ID if authenticated, otherwise IP (IPv6 safe)
            if (req.user?.userId) {
                return `user:${req.user.userId}`;
            }
            const ip = req.ip || 'unknown';
            return `ip:${ip}`;
        },
        handler: (req, res) => {
            logger.warn(`Rate limit exceeded for [${prefix}]`, { 
                ip: req.ip, 
                userId: req.user?.userId,
                path: req.originalUrl 
            });
            res.status(429).json({
                success: false,
                message: message || 'Too many requests, please try again later.'
            });
        }
    });
};

// 1. Refresh Token Limiter (Strict)
export const refreshRateLimiter = createLimiter(
    'refresh',
    15 * 60 * 1000, // 15 minutes
    20, // 20 requests per 15 min
    'Too many refresh attempts, please verify your session.'
);

// 2. Auth Attempts (Login/Register)
export const authRateLimiter = createLimiter(
    'auth',
    60 * 1000, // 1 minute
    10, // 10 attempts per minute
    'Too many login attempts, please try again after a minute.'
);

// 3. Admin Actions (General)
export const adminActionRateLimiter = createLimiter(
    'admin-action',
    60 * 1000, // 1 minute
    60, // 60 requests
    'Admin rate limit exceeded.'
);

// 4. Payment Actions (Critical)
export const paymentRateLimiter = createLimiter(
    'payment',
    60 * 1000, // 1 minute
    10, // 10 payments/edits per minute
    'Payment processing limit exceeded.'
);

// 5. Public Access (Catalog, etc.)
export const publicRateLimiter = createLimiter(
    'public',
    60 * 1000, // 1 minute
    60, // 60 requests
    'Too many requests, please slow down.'
);

// 6. Public Contact Form (Anti-spam)
export const contactRateLimiter = createLimiter(
    'contact',
    60 * 1000, // 1 minute
    5, // 5 submissions per minute per IP/user
    'Too many contact messages, please try again shortly.'
);
