import { ContactMessageInput } from './contact.schema';
import { emailService } from '../../services/email/email.service';
import { AppError } from '../../utils/app-error';

const CONTACT_RECEIVER_EMAIL = process.env.CONTACT_RECEIVER_EMAIL || 't.manalalhihi@gmail.com';

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class ContactService {
    async sendMessage(input: ContactMessageInput) {
        const safeName = escapeHtml(input.name);
        const safeEmail = escapeHtml(input.email);
        const safeSubject = escapeHtml(input.subject);
        const safeMessage = escapeHtml(input.message).replace(/\r?\n/g, '<br/>');

        const result = await emailService.sendEmail({
            to: CONTACT_RECEIVER_EMAIL,
            subject: `[Contact Form] ${input.subject}`,
            replyTo: input.email,
            text: [
                'New contact form message',
                `Name: ${input.name}`,
                `Email: ${input.email}`,
                `Subject: ${input.subject}`,
                'Message:',
                input.message
            ].join('\n'),
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #0f172a;">
                    <h2 style="margin-bottom: 8px;">New Contact Form Message</h2>
                    <p style="margin-top: 0; color: #475569;">A student submitted a new contact request.</p>
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
                        <p><strong>Name:</strong> ${safeName}</p>
                        <p><strong>Email:</strong> ${safeEmail}</p>
                        <p><strong>Subject:</strong> ${safeSubject}</p>
                        <p><strong>Message:</strong><br/>${safeMessage}</p>
                    </div>
                </div>
            `,
        });

        if (!result.success) {
            throw new AppError(result.error || 'Failed to send contact message', 503);
        }

        return {
            delivered: true,
            messageId: result.messageId || null,
        };
    }
}
