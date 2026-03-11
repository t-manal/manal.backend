import { z } from 'zod';

// Phase 8: V2 Simplified Schema
// AssetType enum removed - using string literals instead

export const createCourseSchema = z.object({
    title: z.string().min(3),
    slug: z.string().min(3),
    description: z.string().optional(),
    price: z.number().nonnegative(),
    thumbnail: z.string().url().optional(),
    universityId: z.string().uuid(), // V2: Required direct link to university
    isPublished: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    isFree: z.boolean().optional(),
});

export const updateCourseSchema = createCourseSchema.partial();

// V2: Lecture (was Section)
export const createSectionSchema = z.object({
    title: z.string().min(1),
    order: z.number().int().nonnegative(),
});

export const updateSectionSchema = createSectionSchema.partial();

// V2: Part (was Lesson)
export const createLessonSchema = z.object({
    title: z.string().min(1),
    order: z.number().int().nonnegative(),
});

export const updateLessonSchema = createLessonSchema.partial().extend({
    lectureId: z.string().uuid().optional(),
});

// V2: Asset types are VIDEO (PartLesson) or PDF/PPTX (PartFile)
export const createAssetSchema = z.object({
    title: z.string().min(1),
    type: z.enum(['VIDEO', 'PDF', 'PPTX']), // V2: Simple enum instead of Prisma AssetType
    order: z.number().int().nonnegative(),
    bunnyVideoId: z.string().optional(), // For VIDEO
    storageKey: z.string().optional(), // For PDF/PPTX
});

export const updateAssetSchema = createAssetSchema.partial().extend({
    partId: z.string().uuid().optional(),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type CreateSectionInput = z.infer<typeof createSectionSchema>;
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
export type CreateLessonInput = z.infer<typeof createLessonSchema>;
export type UpdateLessonInput = z.infer<typeof updateLessonSchema>;
export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
