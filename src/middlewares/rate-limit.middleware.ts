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
        standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
        legacyHeaders: false, // Disable the `X-RateLimit-*` headers
        store: new RedisStore({
            sendCommand: (...args: string[]) => redisClient.call(...args),
            prefix: `rate-limit:${prefix}:`
        }),
        keyGenerator: (req) => {
            // Use User ID if authenticated, otherwise IP
            return (req.user?.userId) || req.ip || 'unknown';
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
