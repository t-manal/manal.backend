import { z } from 'zod';

// SECURITY: Registration schema MUST NOT accept 'role' field
// This prevents privilege escalation attacks where users try to register as ADMIN
export const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    phoneNumber: z.string().optional(),
}).strict(); // strict() rejects any extra fields including 'role'

export const verifyEmailSchema = z.object({
    code: z.string().length(6),
});

export const resendCodeSchema = z.object({
    email: z.string().email(),
});

export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

export const updateProfileSchema = z.object({
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    phoneNumber: z.string().optional(),
    bio: z.string().max(2000).optional().nullable(),
});

export const changePasswordSchema = z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(6),
    confirmPassword: z.string().min(6),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
    email: z.string().email(),
});

export const resetPasswordSchema = z.object({
    token: z.string(),
    newPassword: z.string().min(6),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
