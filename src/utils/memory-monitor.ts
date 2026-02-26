import { logger } from './logger';

// Monitor memory usage and trigger GC if needed
export function startMemoryMonitor() {
    const CHECK_INTERVAL = 30000; // 30 seconds
    const CRITICAL_THRESHOLD = 0.95; // 95% heap usage
    const RSS_LIMIT_MB = 400;

    setInterval(() => {
        const usage = process.memoryUsage();
        const heapUsedPercent = usage.heapUsed / usage.heapTotal;
        const rssUsageMB = usage.rss / 1024 / 1024;
        const rssMB = (usage.rss / 1024 / 1024).toFixed(2);
        const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
        const heapTotalMB = (usage.heapTotal / 1024 / 1024).toFixed(2);

        logger.debug('Memory Stats', {
            rss: `${rssMB} MB`,
            heapUsed: `${heapUsedMB} MB`,
            heapTotal: `${heapTotalMB} MB`,
            percentage: `${(heapUsedPercent * 100).toFixed(1)}%`
        });

        if (heapUsedPercent > CRITICAL_THRESHOLD && rssUsageMB > RSS_LIMIT_MB) {
            logger.warn('⚠️ CRITICAL MEMORY USAGE DETECTED');
            
            // If running with --expose-gc, manually trigger garbage collection
            if (global.gc) {
                logger.warn('Triggering Manual Garbage Collection...');
                global.gc();
            } else {
                logger.warn('GC not exposed. Suggest restarting application or increasing memory limit.');
            }
        }
    }, CHECK_INTERVAL);

    logger.info('✅ Memory Monitor Started');
}

export const getMemoryUsage = () => {
    const used = process.memoryUsage();
    return {
        rss: `${Math.round(used.rss / 1024 / 1024 * 100) / 100} MB`,
        heapTotal: `${Math.round(used.heapTotal / 1024 / 1024 * 100) / 100} MB`,
        heapUsed: `${Math.round(used.heapUsed / 1024 / 1024 * 100) / 100} MB`,
        external: `${Math.round(used.external / 1024 / 1024 * 100) / 100} MB`,
    };
};
