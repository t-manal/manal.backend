import { z } from 'zod';

export const uploadThumbnailSchema = z.object({
    params: z.object({
        courseId: z.string().uuid(),
    }),
});

export const uploadAvatarSchema = z.object({});

export const uploadPdfSchema = z.object({
    params: z.object({
        lessonId: z.string().uuid(),
    }),
    query: z.object({
        title: z.string().optional(),
        isSecure: z.string().optional(),
    }).optional(),
    body: z.object({
        title: z.string().optional(),
        isSecure: z.union([z.boolean(), z.string()]).optional(),
    }).optional().default({}),
});
