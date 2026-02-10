import nodemailer from 'nodemailer';
import axios from 'axios';
import { logger } from '../../utils/logger';

export class EmailService {
    private transporter: nodemailer.Transporter;
    private readonly maxRetries = 0; // SMTP fails fast, then fallback
    private readonly brevoApiUrl = 'https://api.brevo.com/v3/smtp/email';

    constructor() {
        // Phase 1: SMTP Hardening
        // Explicitly define secure connection based on port 465
        const smtpPort = Number(process.env.SMTP_PORT) || 2525;
        const isSecure = smtpPort === 465;

        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
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
            debug: process.env.NODE_ENV === 'development',
            logger: process.env.NODE_ENV === 'development'
        });

        // Verify connection on startup (non-blocking)
        this.verifyConnection();
    }

    private async verifyConnection() {
        try {
            await this.transporter.verify();
            logger.info('SMTP connection configuration verified successfully');
        } catch (error: any) {
            // Log warning but don't crash - app can still try fallback
            logger.warn('SMTP connection failed on startup - Email service will rely on fallback', {
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

    // Phase 2: HTTP API Fallback
    private async sendViaBrevoFallback(email: string, subject: string, htmlContent: string) {
        if (!process.env.BREVO_API_KEY) {
            logger.error('SMTP failed and BREVO_API_KEY is missing - Email delivery completely failed', { email });
            return { success: false, error: 'Email delivery failed (No Fallback Configured)' };
        }

        try {
            const sender = this.getSenderIdentity();
            
            // Explicit 15s timeout for HTTP request
            const response = await axios.post(
                this.brevoApiUrl,
                {
                    sender,
                    to: [{ email }],
                    subject,
                    htmlContent 
                },
                {
                    headers: {
                        'api-key': process.env.BREVO_API_KEY,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 10000 // 10s strict timeout
                }
            );

            logger.info('Email delivered via Brevo HTTP API (Fallback)', { 
                email, 
                messageId: response.data.messageId 
            });
            
            return { success: true, messageId: response.data.messageId };

        } catch (error: any) {
            // Safe error logging
            const safeError = {
                status: error.response?.status,
                code: error.code,
                message: error.message,
                data: error.response?.data
            };
            
            logger.error('Brevo HTTP Fallback also failed', { email, error: safeError });
            return { success: false, error: 'Email delivery failed (All channels)' };
        }
    }

    async sendVerificationCode(email: string, code: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
        // Fix incorrect default URL logic (was 'http://localhost:')
        const appUrl = process.env.STUDENT_APP_URL || 'http://localhost:3000';
        
        const mailOptions = {
            from: process.env.SMTP_FROM || '"LMS Support" <support@lms.com>',
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
            `,
        };

        try {
            // Attempt 1: SMTP
            const info = await this.transporter.sendMail(mailOptions);
            logger.info('Verification email sent via SMTP', { email, messageId: info.messageId });
            return { success: true, messageId: info.messageId };
        } catch (error: any) {
            const safeError = {
                code: error.code,
                command: error.command,
                message: error.message
            };
            logger.warn('SMTP Delivery Failed - Switching to HTTP Fallback', { email, error: safeError });
            
            // Attempt 2: HTTP Fallback
            return this.sendViaBrevoFallback(email, mailOptions.subject, mailOptions.html);
        }
    }

    async sendPasswordResetEmail(email: string, resetLink: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
        const mailOptions = {
            from: process.env.SMTP_FROM || '"LMS Support" <support@lms.com>',
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
            `,
        };

        try {
            // Attempt 1: SMTP
            const info = await this.transporter.sendMail(mailOptions);
            logger.info('Password reset email sent via SMTP', { email, messageId: info.messageId });
            return { success: true, messageId: info.messageId };
        } catch (error: any) {
            const safeError = {
                code: error.code,
                command: error.command,
                message: error.message
            };
            logger.warn('SMTP Delivery Failed - Switching to HTTP Fallback', { email, error: safeError });
            
            // Attempt 2: HTTP Fallback
            return this.sendViaBrevoFallback(email, mailOptions.subject, mailOptions.html);
        }
    }
}

export const emailService = new EmailService();
