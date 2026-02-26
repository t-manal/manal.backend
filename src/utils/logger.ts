/**
 * Unified Structured Logger for LMS Backend
 * Outputs JSON to stdout for compatibility with log aggregators.
 * 
 * Features:
 * - Structured JSON output
 * - Log levels: debug, info, warn, error
 * - Automatic sanitization of sensitive data
 * - Request ID correlation support
 */

// Sensitive keys that should never appear in logs
const SENSITIVE_KEYS = [
    'authorization',
    'password',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'token',
    'secret',
    'cookie',
    'cookies',
    'x-auth-token',
];

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    requestId?: string;
    [key: string]: unknown;
}

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    requestId?: string;
    context?: Record<string, unknown>;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
}

/**
 * Recursively sanitizes an object by removing/masking sensitive keys
 */
function sanitize(obj: unknown, depth = 0): unknown {
    // Prevent infinite recursion
    if (depth > 10) return '[MAX_DEPTH]';

    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
        // Check if string looks like a JWT or token
        if (obj.match(/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/)) {
            return '[REDACTED_TOKEN]';
        }
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => sanitize(item, depth + 1));
    }

    if (typeof obj === 'object') {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            const lowerKey = key.toLowerCase();
            if (SENSITIVE_KEYS.some(sensitive => lowerKey.includes(sensitive))) {
                sanitized[key] = '[REDACTED]';
            } else {
                sanitized[key] = sanitize(value, depth + 1);
            }
        }
        return sanitized;
    }

    return obj;
}

class Logger {
    private formatEntry(entry: LogEntry): string {
        return JSON.stringify(entry);
    }

    private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
        };

        if (context?.requestId) {
            entry.requestId = context.requestId;
        }

        if (context) {
            // Remove requestId from context as it's already at top level
            const { requestId, ...restContext } = context;
            if (Object.keys(restContext).length > 0) {
                entry.context = sanitize(restContext) as Record<string, unknown>;
            }
        }

        if (error) {
            entry.error = {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
        }

        const output = this.formatEntry(entry);

        switch (level) {
            case 'error':
                console.error(output);
                break;
            case 'warn':
                console.warn(output);
                break;
            default:
                console.log(output);
        }
    }

    info(message: string, context?: LogContext): void {
        this.log('info', message, context);
    }

    debug(message: string, context?: LogContext): void {
        this.log('debug', message, context);
    }

    warn(message: string, context?: LogContext): void {
        this.log('warn', message, context);
    }

    error(message: string, context?: LogContext, error?: Error): void {
        this.log('error', message, context, error);
    }

    /**
     * Utility to sanitize objects for external use
     */
    sanitize<T>(obj: T): T {
        return sanitize(obj) as T;
    }
}

export const logger = new Logger();
export default logger;
