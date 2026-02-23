import prisma from '../../config/prisma';
import { AppError } from '../../utils/app-error';
import { EnrollmentStatus, PaymentStatus, PaymentProvider } from '@prisma/client';


export class EnrollmentService {
    async createEnrollment(userId: string, courseId: string) {
        // 1. Check if course exists
        const course = await prisma.course.findUnique({
            where: { id: courseId },
        });

        if (!course) {
            throw new AppError('Course not found', 404);
        }

        // 2. Prevent instructor from enrolling in their own course
        if (course.instructorId === userId) {
            throw new AppError('Instructors cannot enroll in their own courses', 400);
        }

        // 3. Check for existing enrollment
        const existingEnrollment = await prisma.enrollment.findUnique({
            where: {
                userId_courseId: { userId, courseId },
            },
        });

        if (existingEnrollment) {
            if (existingEnrollment.status === EnrollmentStatus.ACTIVE) {
                throw new AppError('Already enrolled and active in this course', 400);
            }
            // Return existing pending/canceled enrollment to show waiting screen
            return existingEnrollment;
        }

        // 4. Handle Free Course
        if (course.isFree) {
            return prisma.enrollment.create({
                data: {
                    userId,
                    courseId,
                    status: EnrollmentStatus.ACTIVE,
                    activatedAt: new Date(),
                },
            });
        }

        // 5. Handle Paid Course (Manual Request)
        // Create Enrollment first to get ID for reference
        // We use a transaction to ensure everything is consistent
        return prisma.$transaction(async (tx) => {
            const enrollment = await tx.enrollment.create({
                data: {
                    userId,
                    courseId,
                    status: EnrollmentStatus.PENDING,
                },
            });

            // Create initial Payment Record as Pending Manual
            await tx.paymentRecord.create({
                data: {
                    enrollmentId: enrollment.id,
                    userId,
                    courseId,
                    provider: PaymentProvider.MANUAL_WHATSAPP,
                    amount: course.price,
                    agreedPrice: course.price,
                    status: PaymentStatus.PENDING,
                    providerEventId: `REQ_${enrollment.id}_${Date.now()}`,
                },
            });

            return enrollment;
        });
    }

    async handleWebhook(provider: PaymentProvider, payload: any) {
        // ... (existing helper for other providers if needed, though Stripe uses a dedicated controller method usually for signature verification)
        // Keeping this skeleton for PayPal/Visa compat if they use the old way

        // Skeleton implementation: Assume payload has { eventId, transactionId, status, enrollmentId }
        // In reality, each provider has its own structure.

        const { eventId, transactionId, status, enrollmentId } = payload;

        // 1. Idempotency Check
        const existingEvent = await prisma.paymentRecord.findUnique({
            where: { providerEventId: eventId },
        });

        if (existingEvent && existingEvent.status !== PaymentStatus.PENDING) {
            return { message: 'Webhook already processed' };
        }

        return prisma.$transaction(async (tx) => {
            // 2. Update Payment Record
            const paymentRecord = await tx.paymentRecord.upsert({
                where: { providerEventId: eventId },
                update: {
                    status: status === 'COMPLETED' ? PaymentStatus.COMPLETED : PaymentStatus.FAILED,
                    providerTransactionId: transactionId,
                    rawPayload: payload,
                },
                create: {
                    enrollmentId,
                    userId: payload.userId, // Skeleton assumption
                    courseId: payload.courseId,
                    provider,
                    providerEventId: eventId,
                    providerTransactionId: transactionId,
                    amount: payload.amount,
                    status: status === 'COMPLETED' ? PaymentStatus.COMPLETED : PaymentStatus.FAILED,
                    rawPayload: payload,
                }
            });

            // 3. If completed, activate enrollment
            if (status === 'COMPLETED') {
                const enrollment = await tx.enrollment.update({
                    where: { id: paymentRecord.enrollmentId },
                    data: {
                        status: EnrollmentStatus.ACTIVE,
                        activatedAt: new Date(),
                    },
                });
                return { message: 'Enrollment activated', enrollmentId: enrollment.id };
            }

            return { message: 'Payment failed' };
        });
    }
}
