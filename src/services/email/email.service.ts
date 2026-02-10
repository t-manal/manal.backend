import nodemailer from 'nodemailer';
import { logger } from '../../utils/logger';

export class EmailService {
    private transporter: nodemailer.Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
            port: Number(process.env.SMTP_PORT) || 2525,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    async sendVerificationCode(email: string, code: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
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
                        <a href="${process.env.STUDENT_APP_URL || 'http://localhost:'}/verify-email" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                            Verify Email
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes.</p>
                </div>
            `,
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            logger.info('Verification email sent', { email, messageId: info.messageId });
            return { success: true, messageId: info.messageId };
        } catch (error: any) {
            // Sanitize error logging - do not log full error object if it contains auth info
            const safeError = {
                message: error.message,
                code: error.code,
                command: error.command
            };
            logger.error('Failed to send verification email', { email, error: safeError });
            return { success: false, error: 'Email delivery failed' };
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
            const info = await this.transporter.sendMail(mailOptions);
            logger.info('Password reset email sent', { email, messageId: info.messageId });
            return { success: true, messageId: info.messageId };
        } catch (error: any) {
            const safeError = {
                message: error.message,
                code: error.code,
                command: error.command
            };
            logger.error('Failed to send password reset email', { email, error: safeError });
            return { success: false, error: 'Email delivery failed' };
        }
    }
}

export const emailService = new EmailService();
