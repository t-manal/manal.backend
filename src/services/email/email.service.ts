import nodemailer from 'nodemailer';
import { logger } from '../../utils/logger';

export interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export class EmailService {
    private transporter: nodemailer.Transporter;
    private readonly brevoApiUrl = 'https://api.brevo.com/v3/smtp/email';
    private readonly isProduction = process.env.NODE_ENV === 'production';

    constructor() {
        // Phase 1: SMTP Hardening
        const smtpPort = Number(process.env.SMTP_PORT) || 587;
        const isSecure = smtpPort === 465;

        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
            port: smtpPort,
            secure: isSecure, // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
            // FAST TIMEOUTS (Mandatory for Railway)
            // Prevent 120s hangs by failing fast (~10-15s max)
            connectionTimeout: 10000, // 10s - Initial connection
            greetingTimeout: 10000,   // 10s - Server greeting
            socketTimeout: 15000,     // 15s - Inactivity
            tls: {
                minVersion: 'TLSv1.2',
                rejectUnauthorized: true, // Fail if cert is invalid
            },
            // Debug logs in dev only
            debug: !this.isProduction,
            logger: !this.isProduction
        });

        // Verify connection on startup (non-blocking) - Skip in production (API First)
        if (!this.isProduction) {
            this.verifyConnection();
        }
    }

    private async verifyConnection() {
        try {
            await this.transporter.verify();
            logger.info('SMTP connection configuration verified successfully');
        } catch (error: any) {
            // Log warning but don't crash - app relies on fallback
            logger.warn('SMTP connection failed on startup - Email service will rely on HTTP fallback', {
                code: error.code,
                message: error.message
            });
        }
    }

    /**
     * Helper to parse sender Identity for Brevo API
     * Returns { name, email }
     */
    private getSenderIdentity() {
        const fromString = process.env.SMTP_FROM || 'LMS Support <support@lms.com>';
        
        // Try to parse "Name <email>" format
        const match = fromString.match(/"?([^"]*)"?\s*<(.+)>/);
        if (match) {
            return { name: match[1].trim(), email: match[2].trim() };
        }
        
        // Fallback if just email provided
        return { name: 'LMS Support', email: fromString.trim() };
    }

    /**
     * Phase 2: HTTP Fallback (Native Fetch)
     * Used as PRIMARY method in Production
     */
    private async sendViaBrevoFallback(email: string, subject: string, htmlContent: string) {
        const apiKey = process.env.BREVO_API_KEY?.trim();

        if (!apiKey) {
            logger.error('Email delivery failed: BREVO_API_KEY is missing/empty', { email });
            return { success: false, error: 'Email delivery failed (No Fallback Configured)' };
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // Strict 10s timeout

        try {
            const sender = this.getSenderIdentity();
            
            const response = await fetch(this.brevoApiUrl, {
                method: 'POST',
                headers: {
                    'api-key': apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    sender,
                    to: [{ email }],
                    subject,
                    htmlContent 
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`HTTP ${response.status}: ${JSON.stringify(errorData)}`);
            }

            const data = await response.json() as { messageId?: string };

            logger.info('Email delivered via Brevo HTTP API', { 
                email, 
                messageId: data.messageId,
                mode: this.isProduction ? 'Primary (Production)' : 'Fallback (Dev/Error)'
            });
            
            return { success: true, messageId: data.messageId };

        } catch (error: any) {
            clearTimeout(timeoutId);

            // Safe error logging
            const safeError = {
                name: error.name,
                message: error.message,
                cause: error.cause
            };
            
            logger.error('Brevo HTTP API delivery attempt failed', { email, error: safeError });
            return { success: false, error: 'Email delivery failed (All channels)' };
        }
    }

    /**
     * Generic send method that creates the correct context for sending
     */
    async sendEmail(options: EmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
        // PRODUCTION: Direct to HTTP API (API-First)
        if (this.isProduction) {
            return this.sendViaBrevoFallback(options.to, options.subject, options.html);
        }

        // DEVELOPMENT: Try SMTP -> Fallback to HTTP
        const mailOptions = {
            from: process.env.SMTP_FROM || '"LMS Support" <support@lms.com>',
            to: options.to,
            subject: options.subject,
            text: options.text || options.html.replace(/<[^>]*>?/gm, ''), // Strip tags for text version if not provided
            html: options.html,
        };

        try {
            // Attempt 1: SMTP
            const info = await this.transporter.sendMail(mailOptions);
            logger.info('Email sent via SMTP', { email: options.to, messageId: info.messageId });
            return { success: true, messageId: info.messageId };
        } catch (error: any) {
            const safeError = {
                code: error.code,
                command: error.command,
                message: error.message
            };
            logger.warn('SMTP Delivery Failed - Switching to HTTP Fallback', { email: options.to, error: safeError });
            
            // Attempt 2: HTTP Fallback
            return this.sendViaBrevoFallback(options.to, options.subject, options.html);
        }
    }

    async sendVerificationCode(email: string, code: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
        const appUrl = process.env.STUDENT_APP_URL || 'http://localhost:3000';
        
        return this.sendEmail({
            to: email,
            subject: 'Email Verification Code',
            text: `Your verification code is: ${code}. It expires in 10 minutes.`,
            html: `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #4f46e5;">Verify Your Email</h2>
                    <p>Thank you for registering. Please use the following code to verify your email address:</p>
                    <div style="font-size: 24px; font-weight: bold; background: #f3f4f6; padding: 10px; text-align: center; border-radius: 5px; margin: 20px 0;">
                        ${code}
                    </div>
                    <div style="text-align: center; margin-bottom: 20px;">
                        <a href="${appUrl}/verify-email" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                            Verify Email
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes.</p>
                </div>
            `
        });
    }

    async sendPasswordResetEmail(email: string, resetLink: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
        return this.sendEmail({
            to: email,
            subject: 'Reset Your Password',
            text: `You requested a password reset. Click here to reset: ${resetLink}. This link expires in 10 minutes.`,
            html: `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #4f46e5;">Password Reset Request</h2>
                    <p>You requested to reset your password. Click the button below to proceed:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                            Reset Password
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">This link will expire in 10 minutes.</p>
                    <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
                </div>
            `
        });
    }
}

export const emailService = new EmailService();
