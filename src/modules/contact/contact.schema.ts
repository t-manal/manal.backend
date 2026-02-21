import { z } from 'zod';

export const contactMessageSchema = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    subject: z.string().trim().min(3).max(160),
    message: z.string().trim().min(10).max(5000),
}).strict();

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;
