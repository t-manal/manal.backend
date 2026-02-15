import prisma from '../config/prisma';
import Redis from 'ioredis';
import { logger } from './logger';

const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true // Don't connect immediately, wait for explicit check
});

export async function performStartupChecks(): Promise<boolean> {
    logger.info('Starting Pre-flight Health Checks...');

    try {
        // 1. Database Check
        await prisma.$queryRaw`SELECT 1`;
        logger.info('✅ Database connected successfully');

        // 2. Redis Check
        await redisClient.connect();
        await redisClient.ping();
        logger.info('✅ Redis connected successfully');
        await redisClient.quit(); // Close connection after check

        // 3. Environment Variables Check
        const requiredVars = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
        const missing = requiredVars.filter(v => !process.env[v]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
        logger.info('✅ Environment variables validated');

        return true;
    } catch (error) {
        logger.error('❌ Startup Check Failed:', {}, error as Error);
        return false;
    }
}
