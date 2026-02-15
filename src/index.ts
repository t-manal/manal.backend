import dotenv from 'dotenv';
dotenv.config();

import { validateBunnyEnv } from './config/env-validator';
validateBunnyEnv();

// PHASE 10 FIX: Initialize Worker Mechanism
import './workers/pdf.worker';

import { logger } from './utils/logger';
import app from './app';

const port = process.env.PORT || 4000;

// Global unhandled exception handlers
process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception - Process will exit', { processEvent: 'uncaughtException' }, error);
    process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled Promise Rejection', { processEvent: 'unhandledRejection' }, error);
});

// PHASE 1 FIX: Startup Checks & Monitoring
import { performStartupChecks } from './utils/health-check';
import { startMemoryMonitor } from './utils/memory-monitor';
import prisma from './config/prisma';

const startServer = async () => {
    try {
        const isHealthy = await performStartupChecks();
        if (!isHealthy) {
            logger.error('Startup checks failed. Exiting process.');
            process.exit(1);
        }

        startMemoryMonitor();

        const server = app.listen(port, () => {
            logger.info('Server started', { port, nodeEnv: process.env.NODE_ENV || 'development' });
        });

        // PHASE 1 FIX: Graceful Shutdown
        const shutdown = async (signal: string) => {
            logger.info(`${signal} received. Starting graceful shutdown...`);
            
            // 1. Stop accepting new connections
            server.close(() => {
                logger.info('HTTP server closed');
            });

            // 2. Set timeout for remaining work
            setTimeout(() => {
                logger.warn('Forcefully closing remaining connections');
                process.exit(1);
            }, 30000); // 30s timeout

            try {
                // 3. Close Database
                await prisma.$disconnect();
                logger.info('Database disconnected');
                
                // 4. Redis (ioredis manages its own handles generally, but if we had a global instance we'd quit it here)
                // For now, most Redis usage is transient or managed.
                
                logger.info('Graceful shutdown complete');
                process.exit(0);
            } catch (error) {
                logger.error('Shutdown error:', {}, error as Error);
                process.exit(1);
            }
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
        logger.error('Failed to start server:', {}, error as Error);
        process.exit(1);
    }
};

startServer();

