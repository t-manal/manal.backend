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
        const requiredVars = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
        const missing = requiredVars.filter(v => !process.env[v]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
        logger.info('✅ Environment variables validated');

        // 4. Email delivery configuration checks (non-fatal except in production with no channel)
        const hasBrevoApi = Boolean(process.env.BREVO_API_KEY?.trim());
        const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

        if (process.env.NODE_ENV === 'production' && !hasBrevoApi && !hasSmtp) {
            throw new Error('No email delivery channel configured (BREVO_API_KEY or SMTP credentials required)');
        }

        if (process.env.NODE_ENV === 'production' && !hasBrevoApi && hasSmtp) {
            logger.warn('BREVO_API_KEY is missing in production; SMTP fallback will be used for email delivery');
        }

        if (process.env.NODE_ENV === 'production') {
            const studentAppUrl = process.env.STUDENT_APP_URL || '';
            if (!studentAppUrl || studentAppUrl.includes('localhost') || studentAppUrl.includes('127.0.0.1')) {
                logger.warn('STUDENT_APP_URL is missing or points to localhost in production; reset/verification links may be invalid');
            }
        }

        return true;
    } catch (error) {
        logger.error('❌ Startup Check Failed:', {}, error as Error);
        return false;
    }
}
