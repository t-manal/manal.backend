

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { errorMiddleware } from './middlewares/error.middleware';
import { UPLOAD_LIMITS } from './config/upload-limits.config';
import { requestLoggerMiddleware } from './middlewares/request-logger.middleware';
import authRoutes from './modules/auth/auth.routes';
import catalogRoutes from './modules/catalog/catalog.routes';
import instructorRoutes from './modules/courses/instructor-content.routes';
import enrollmentRoutes from './modules/enrollments/enrollment.routes';
import studentCourseRoutes from './modules/courses/student-content.routes';
import progressRoutes from './modules/progress/progress.routes';
import userRoutes from './modules/users/users.routes';

// Phase 8: V2 Clean App - Removed orphaned modules:
// - engagement (Comment/Like removed from schema)
// - quizzes (Quiz removed from schema)
// - support (SupportTicket removed from schema)
// - ratings (Rating removed from schema)

const app = express();

// Global Middlewares
app.set('trust proxy', 1); // Trust first proxy (useful for rate limiting behind load balancers/ngrok)
app.use(helmet());
app.use(cors({
    origin: (requestOrigin, callback) => {
        const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [
            'http://localhost:3000',
            'https://student-frontend-bice.vercel.app', 
            'http://localhost:3001',
            'https://admin-lms-pi.vercel.app' // Explicitly added for production Vercel support
        ];
        
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!requestOrigin) return callback(null, true);
        
        if (allowedOrigins.indexOf(requestOrigin) !== -1) {
            callback(null, true);
        } else {
            // Optional: Log blocked origins for debugging
            // console.warn(`Blocked CORS origin: ${requestOrigin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
}
// POLICY: Body size limits to prevent DoS via large JSON/form payloads
app.use(express.json({
    limit: UPLOAD_LIMITS.MAX_BODY_SIZE,
    verify: (req: any, res, buf) => {
        if (req.originalUrl && req.originalUrl.includes('/webhooks/stripe')) {
            req.rawBody = buf;
        }
    }
}));
app.use(express.urlencoded({ extended: true, limit: UPLOAD_LIMITS.MAX_BODY_SIZE }));
app.use(cookieParser());

// Structured request logging (after cookie parser, before routes)
app.use(requestLoggerMiddleware);

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
import uploadRoutes from './modules/upload/upload.routes';
app.use('/api/v1', uploadRoutes);

// Admin Routes (New Manual Flow)
import adminRoutes from './modules/admin/admin.routes';
app.use('/api/v1/admin', adminRoutes);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/catalog', catalogRoutes);
app.use('/api/v1/instructor', instructorRoutes);
app.use('/api/v1/enrollments', enrollmentRoutes);
app.use('/api/v1/courses', studentCourseRoutes);
app.use('/api/v1/progress', progressRoutes);
app.use('/api/v1/students', userRoutes);

// Payments (Admin)
import instructorPaymentsRoutes from './modules/payments/instructor-payments.routes';
app.use('/api/v1/instructor/payments', instructorPaymentsRoutes);

// Webhooks (Public endpoints with signature verification)
import bunnyWebhookRoutes from './modules/webhooks/bunny-webhook.routes';
app.use('/api/v1/webhooks', bunnyWebhookRoutes);

// Error Handling (Must be last)
app.use(errorMiddleware);

export default app;
