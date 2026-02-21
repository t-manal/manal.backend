import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import { EnrollmentStatus, PaymentProvider, PaymentStatus } from '@prisma/client';
import { z } from 'zod';
import { ApiResponse } from '../../utils/api-response';
import { Money } from '../../utils/money.util';

export class AdminPurchasesController {
    // GET /api/v1/admin/purchases/pending
    public listPending = async (req: Request, res: Response) => {
        try {
            // Fetch Pending enrollments (Paid = 0)
            const pendingEnrollments = await prisma.enrollment.findMany({
                where: {
                    status: EnrollmentStatus.PENDING,
                    paymentRecords: {
                         none: { status: PaymentStatus.COMPLETED } // Only show truly untouched requests
                    }
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                        }
                    },
                    course: {
                        select: {
                            id: true,
                            title: true,
                            price: true,
                            university: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            }
                        }
                    },
                    paymentRecords: {
                         orderBy: { createdAt: 'desc' }
                    }
                },
                orderBy: {
                    enrolledAt: 'desc'
                }
            });

            // Calculate Ledger State
            const ledger = pendingEnrollments.map(e => {
                const price = Money.fromNumber(e.course.price);
                const paidAmount = Money.zero(); // Filtered to 0
                const remaining = price; // Since paid is 0
                
                return {
                    ...e,
                    ledger: {
                        price: price.toNumber(),
                        paidAmount: paidAmount.toNumber(),
                        remaining: remaining.toNumber(),
                        paymentState: 'UNPAID'
                    }
                };
            });

            return ApiResponse.success(res, ledger);
        } catch (error) {
            console.error('[AdminPurchases] List Pending Error:', error);
            return ApiResponse.error(res, error, 'Internal Server Error');
        }
    };

    // GET /api/v1/admin/purchases/ledger
    public listLedger = async (req: Request, res: Response) => {
        try {
            // Fetch All "Touched" Enrollments (Active OR Paid > 0)
            const enrollments = await prisma.enrollment.findMany({
                where: {
                    OR: [
                        { status: EnrollmentStatus.ACTIVE },
                        { paymentRecords: { some: { status: PaymentStatus.COMPLETED } } }
                    ]
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                        }
                    },
                    course: {
                        select: {
                            id: true,
                            title: true,
                            price: true,
                            university: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            }
                        }
                    },
                    paymentRecords: {
                        where: { status: PaymentStatus.COMPLETED },
                        orderBy: { createdAt: 'desc' }
                    }
                },
                orderBy: {
                    enrolledAt: 'desc'
                }
            });

            const ledger = enrollments.map(e => {
                const price = Money.fromNumber(e.course.price);
                
                const paidAmount = e.paymentRecords.reduce(
                    (sum, p) => sum.add(Money.fromNumber(p.amount)), 
                    Money.zero()
                );
                
                // remaining = max(0, price - paid)
                let remaining = price.subtract(paidAmount);
                if (remaining.lessThan(Money.zero())) {
                    remaining = Money.zero();
                }
                
                let paymentState = 'UNPAID';
                if (paidAmount.greaterThanOrEqualTo(price)) paymentState = 'FULLY_PAID'; 
                else if (paidAmount.greaterThan(Money.zero())) paymentState = 'PARTIALLY_PAID';

                return {
                    ...e,
                    ledger: {
                        price: price.toNumber(),
                        paidAmount: paidAmount.toNumber(),
                        remaining: remaining.toNumber(),
                        paymentState
                    }
                };
            });

            return ApiResponse.success(res, ledger);
        } catch (error) {
            console.error('[AdminPurchases] List Ledger Error:', error);
            return ApiResponse.error(res, error, 'Internal Server Error');
        }
    };

    // POST /api/v1/admin/purchases/:enrollmentId/mark-paid
    public markPaid = async (req: Request, res: Response) => {
        const { enrollmentId } = req.params;
        const schema = z.object({
            amount: z.number().min(0).optional()
        });

        try {
            const { amount: rawAmount } = schema.parse(req.body);

            // Phase 2 FIX: Transaction with Row-Level Lock
            const result = await prisma.$transaction(async (tx) => {
                // 1. Lock Enrollment Row [CRITICAL]
                // SELECT FOR UPDATE enforces sequential access to this enrollment
                const lockedEnrollments = await tx.$queryRaw`
                    SELECT id FROM "enrollments" 
                    WHERE id = ${enrollmentId}
                    FOR UPDATE NOWAIT
                `; // Note: prisma raw query returns array

                if (!Array.isArray(lockedEnrollments) || lockedEnrollments.length === 0) {
                     // If we can't find it, it might not exist.
                     // But if it's locked by someone else, NOWAIT throws error (handled in catch)
                     throw new Error('Enrollment not found (or locked)');
                }

                // 2. Fetch Fresh Data (Safe now)
                const enrollment = await tx.enrollment.findUniqueOrThrow({
                    where: { id: enrollmentId },
                    include: { course: true, paymentRecords: true }
                });

                // Calculate Financials
                const currentPaid = enrollment.paymentRecords
                    .filter(p => p.status === PaymentStatus.COMPLETED)
                    .reduce((sum, p) => sum.add(Money.fromNumber(p.amount)), Money.zero());
                
                const price = Money.fromNumber(enrollment.course.price);
                // remaining = max(0, price - paid)
                let remaining = price.subtract(currentPaid);
                if (remaining.lessThan(Money.zero())) remaining = Money.zero();

                const paymentAmount = rawAmount !== undefined 
                    ? Money.fromNumber(rawAmount) 
                    : remaining;

                // Zero Price Settlement Rule
                if (price.equals(Money.zero())) {
                     if (paymentAmount.greaterThan(Money.zero())) {
                         throw new Error('Zero-priced courses cannot accept payments > 0');
                     }
                } else {
                     if (paymentAmount.lessThanOrEqualTo(Money.zero())) {
                         throw new Error('Payment amount must be positive for paid courses');
                     }
                }

                // Strict Price Cap Validation
                // newTotal = current + payment
                const newTotalPaid = currentPaid.add(paymentAmount);
                
                if (newTotalPaid.greaterThan(price)) {
                    throw new Error(`Payment exceeds course price. Max allowed: ${remaining.toString()}`);
                }

                // 3. Handle Payment Record
                const pendingRecord = await tx.paymentRecord.findFirst({
                    where: {
                        enrollmentId: enrollment.id,
                        status: PaymentStatus.PENDING
                    }
                });

                if (pendingRecord) {
                    await tx.paymentRecord.update({
                        where: { id: pendingRecord.id },
                        data: {
                            status: PaymentStatus.COMPLETED,
                            amount: paymentAmount.toDecimal(),
                            provider: PaymentProvider.MANUAL_WHATSAPP,
                            providerEventId: `MANUAL_APPROVE_${Date.now()}_${req.user?.userId || 'ADMIN'}`
                        }
                    });
                } else {
                    await tx.paymentRecord.create({
                        data: {
                            enrollmentId: enrollment.id,
                            userId: enrollment.userId,
                            courseId: enrollment.courseId,
                            provider: PaymentProvider.MANUAL_WHATSAPP,
                            status: PaymentStatus.COMPLETED,
                            amount: paymentAmount.toDecimal(),
                            providerEventId: `MANUAL_APPROVE_${Date.now()}_${req.user?.userId || 'ADMIN'}`
                        }
                    });
                }

                // 4. Enforce New Access Rule (Any payment > 0 => Active)
                let newStatus: EnrollmentStatus = EnrollmentStatus.PENDING;
                let activatedAt = enrollment.activatedAt;
                
                if (newTotalPaid.greaterThan(Money.zero()) || (price.equals(Money.zero()) && newTotalPaid.equals(Money.zero()))) {
                     newStatus = EnrollmentStatus.ACTIVE;
                     if (!activatedAt) activatedAt = new Date();
                }

                const updatedEnrollment = await tx.enrollment.update({
                    where: { id: enrollmentId },
                    data: {
                        status: newStatus,
                        activatedAt: newStatus === EnrollmentStatus.ACTIVE ? activatedAt : enrollment.activatedAt
                    }
                });

                return { updatedEnrollment, newTotalPaid, price };
            }, {
                timeout: 5000, // 5s timeout to acquire lock
                isolationLevel: 'ReadCommitted' // Sufficient with FOR UPDATE
            });

            return ApiResponse.success(res, { 
                enrollment: result.updatedEnrollment,
                ledger: {
                    paid: result.newTotalPaid.toNumber(),
                    price: result.price.toNumber(),
                    remaining: result.price.subtract(result.newTotalPaid).toNumber(),
                    status: result.updatedEnrollment.status
                }
            }, 'Payment recorded');

        } catch (error: any) {
            console.error('[AdminPurchases] Mark Paid Error:', error);
            
            // Handle lock contention only (Postgres 55P03 with NOWAIT)
            if (
                (error.code === 'P2010' && error.meta?.code === '55P03') ||
                error.message?.includes('could not obtain lock')
            ) {
                return ApiResponse.error(res, null, 'System is busy processing another payment for this enrollment. Please try again.', 409);
            }
            // Handle Logic Errors
            if (error.message?.includes('exceeds course price') || error.message?.includes('Zero-priced')) {
                return ApiResponse.error(res, null, error.message, 400); 
            }

            return ApiResponse.error(res, error, 'Internal Server Error');
        }
    };

    // PUT /api/v1/admin/purchases/payments/:paymentId
    public updatePayment = async (req: Request, res: Response) => {
        const { paymentId } = req.params;
        const schema = z.object({
            amount: z.number().min(0)
        });

        try {
            const { amount: rawAmount } = schema.parse(req.body);
            const amount = Money.fromNumber(rawAmount);

            const payment = await prisma.paymentRecord.findUnique({
                where: { id: paymentId },
                include: { enrollment: { include: { course: true } } }
            });

            if (!payment) {
                return ApiResponse.error(res, null, 'Payment not found', 404);
            }

            if (payment.status !== PaymentStatus.COMPLETED) {
                return ApiResponse.error(res, null, 'Only completed payments can be edited', 400);
            }

            // Validation: Price Cap Check before saving
            // Need to calculate what total WOULD be
            const othersSum = await prisma.paymentRecord.aggregate({
                _sum: { amount: true },
                where: { 
                     enrollmentId: payment.enrollmentId, 
                     status: PaymentStatus.COMPLETED,
                     id: { not: paymentId } 
                }
            });
            const othersTotal = Money.fromNumber(othersSum._sum.amount?.toNumber() || 0);
            const potentialTotal = othersTotal.add(amount);
            const price = Money.fromNumber(payment.enrollment.course.price);

            if (potentialTotal.greaterThan(price)) {
                 return ApiResponse.error(res, null, `New total (${potentialTotal.toString()}) exceeds price (${price.toString()})`, 400);
            }

            // Zero Price Rule for Edits
            if (price.equals(Money.zero())) {
                if (amount.greaterThan(Money.zero())) {
                    return ApiResponse.error(res, null, 'Zero-priced courses cannot accept payments > 0', 400);
                }
            } else {
                if (amount.lessThanOrEqualTo(Money.zero())) {
                    return ApiResponse.error(res, null, 'Payment amount must be positive for paid courses', 400);
                }
            }

            const result = await prisma.$transaction(async (tx) => {
                // 1. Audit Log
                const previousPayload = (payment.rawPayload as any) || {};
                const auditLog = {
                    ...previousPayload,
                    audit: [
                        ...(previousPayload.audit || []),
                        {
                            action: 'UPDATE_AMOUNT',
                            previousAmount: Number(payment.amount),
                            newAmount: amount.toNumber(),
                            date: new Date().toISOString(),
                            adminId: req.user?.userId || 'ADMIN'
                        }
                    ]
                };

                // 2. Update Payment
                await tx.paymentRecord.update({
                    where: { id: paymentId },
                    data: {
                        amount: amount.toDecimal(),
                        rawPayload: auditLog
                    }
                });

                // 3. Re-Calculate Enrollment Status
                let newStatus: EnrollmentStatus = EnrollmentStatus.PENDING;
                let activatedAt = payment.enrollment.activatedAt;

                if (potentialTotal.greaterThan(Money.zero()) || (price.equals(Money.zero()) && potentialTotal.equals(Money.zero()))) {
                     newStatus = EnrollmentStatus.ACTIVE;
                     if (!activatedAt) activatedAt = new Date();
                }

                // Apply Status Change
                const updatedEnrollment = await tx.enrollment.update({
                    where: { id: payment.enrollmentId },
                    data: {
                        status: newStatus,
                        activatedAt: newStatus === EnrollmentStatus.ACTIVE ? activatedAt : payment.enrollment.activatedAt
                    }
                });

                return { updatedEnrollment, totalPaid: potentialTotal };
            });

            return ApiResponse.success(res, {
                enrollment: result.updatedEnrollment,
                ledger: {
                    totalPaid: result.totalPaid.toNumber()
                }
            }, 'Payment updated');

        } catch (error) {
            console.error('[AdminPurchases] Update Payment Error:', error);
            return ApiResponse.error(res, error, 'Internal Server Error');
        }
    };

    // GET /api/v1/admin/purchases/history/export
    public exportHistory = async (req: Request, res: Response) => {
        try {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="payments_export_${new Date().toISOString().split('T')[0]}.csv"`);

            const headers = ['RequestID', 'StudentName', 'StudentEmail', 'University', 'Course', 'CoursePrice', 'PaidAmount', 'Currency', 'Date', 'TransactionID'];
            res.write(headers.join(',') + '\n');

            const BATCH_SIZE = 500;
            let cursor: string | undefined;
            let hasMore = true;

            while (hasMore) {
                const payments = await prisma.paymentRecord.findMany({
                    take: BATCH_SIZE,
                    skip: cursor ? 1 : 0,
                    cursor: cursor ? { id: cursor } : undefined,
                    where: {
                        status: PaymentStatus.COMPLETED,
                        provider: PaymentProvider.MANUAL_WHATSAPP
                    },
                    include: {
                        user: { select: { email: true, firstName: true, lastName: true } },
                        course: { select: { title: true, price: true, university: { select: { name: true } } } },
                        enrollment: { select: { id: true } }
                    },
                    orderBy: { id: 'desc' } // Deterministic ordering for cursor
                });

                if (payments.length === 0) {
                    hasMore = false;
                    break;
                }

                const csvChunk = payments.map(p => {
                    const row = {
                        RequestID: p.enrollmentId,
                        StudentName: `${p.user.firstName} ${p.user.lastName}`,
                        StudentEmail: p.user.email,
                        University: p.course.university.name,
                        Course: p.course.title,
                        CoursePrice: p.course.price,
                        PaidAmount: p.amount,
                        Currency: p.currency,
                        Date: p.createdAt.toISOString(),
                        TransactionID: p.id
                    };
                    
                    return headers.map(header => {
                        const val = (row as any)[header] || '';
                        const escaped = String(val).replace(/"/g, '""');
                        return `"${escaped}"`;
                    }).join(',');
                }).join('\n');

                res.write(csvChunk + '\n');

                if (payments.length < BATCH_SIZE) {
                    hasMore = false;
                    cursor = undefined; // safety
                } else {
                    cursor = payments[payments.length - 1].id;
                }
            }

            res.end();

        } catch (error) {
            console.error('[AdminPurchases] Export Error:', error);
            // If headers already sent, we can't send JSON error. End stream.
            if (!res.headersSent) {
                return ApiResponse.error(res, error, 'Internal Server Error');
            }
            res.end();
        }
    };

    // GET /api/v1/admin/revenue/summary
    public getRevenueSummary = async (req: Request, res: Response) => {
        try {
            // 1. Total Received (All approved manual payments)
            const totalRevenue = await prisma.paymentRecord.aggregate({
                where: {
                    status: PaymentStatus.COMPLETED,
                    provider: PaymentProvider.MANUAL_WHATSAPP
                },
                _sum: {
                    amount: true
                }
            });

            // 2. Revenue By Course
            const revenueByCourse = await prisma.paymentRecord.groupBy({
                by: ['courseId'],
                where: {
                    status: PaymentStatus.COMPLETED,
                    provider: PaymentProvider.MANUAL_WHATSAPP
                },
                _sum: {
                    amount: true
                },
                _count: {
                    id: true
                }
            });

            // 3. Total Outstanding Calculation
            const allEnrollments = await prisma.enrollment.findMany({
                where: {
                   status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.PENDING] }
                },
                select: {
                    id: true,
                    course: { select: { price: true } }
                }
            });

            const paymentsByEnrollment = await prisma.paymentRecord.groupBy({
                by: ['enrollmentId'],
                where: {
                    status: PaymentStatus.COMPLETED,
                },
                _sum: {
                    amount: true
                }
            });

            const paidMap = new Map<string, Money>();
            paymentsByEnrollment.forEach(p => {
                paidMap.set(p.enrollmentId, Money.fromNumber(p._sum.amount?.toNumber() || 0));
            });

            let totalOutstanding = Money.zero();
            for (const e of allEnrollments) {
                 const price = Money.fromNumber(e.course.price);
                 if (price.greaterThan(Money.zero())) {
                     const paid = paidMap.get(e.id) || Money.zero();
                     const remaining = price.subtract(paid);
                     
                     if (remaining.greaterThan(Money.zero())) {
                        totalOutstanding = totalOutstanding.add(remaining);
                     }
                 }
            }

            // Enrich Revenue
            const courseIds = revenueByCourse.map(r => r.courseId);
            const courses = await prisma.course.findMany({
                where: { id: { in: courseIds } },
                select: { id: true, title: true }
            });

            const enrichedRevenue = revenueByCourse.map(r => ({
                courseId: r.courseId,
                title: courses.find(c => c.id === r.courseId)?.title || 'Unknown',
                amount: r._sum.amount ? r._sum.amount.toNumber() : 0,
                count: r._count.id
            }));

            return ApiResponse.success(res, {
                total: totalRevenue._sum.amount ? totalRevenue._sum.amount.toNumber() : 0,
                outstanding: totalOutstanding.toNumber(),
                byCourse: enrichedRevenue
            });
        } catch (error) {
            console.error('[AdminPurchases] Revenue Summary Error:', error);
            return ApiResponse.error(res, error, 'Internal Server Error');
        }
    };

    // GET /api/v1/admin/revenue/timeseries
    public getRevenueTimeseries = async (req: Request, res: Response) => {
        try {
            const days = Number(req.query.days) || 14;
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - days + 1); 
            
            const revenueByDay: any[] = await prisma.$queryRaw`
                SELECT 
                    DATE_TRUNC('day', "createdAt") as date,
                    SUM("amount") as amount
                FROM "payment_records"
                WHERE 
                    "status" = 'COMPLETED' 
                    AND "provider" = 'MANUAL_WHATSAPP'
                    AND "createdAt" >= ${startDate}
                GROUP BY DATE_TRUNC('day', "createdAt")
                ORDER BY date ASC
            `;

            const series: { date: string; amount: number }[] = [];
            const dbMap = new Map<string, number>();
            revenueByDay.forEach((row: any) => {
                const d = new Date(row.date).toISOString().split('T')[0];
                dbMap.set(d, Number(row.amount));
            });

            for (let i = 0; i < days; i++) {
                const d = new Date();
                d.setDate(d.getDate() - (days - 1 - i));
                const dateKey = d.toISOString().split('T')[0];
                
                series.push({
                    date: dateKey,
                    amount: dbMap.get(dateKey) || 0
                });
            }

            return ApiResponse.success(res, { series });

        } catch (error) {
            console.error('[AdminPurchases] Revenue Timeseries Error:', error);
            return ApiResponse.error(res, error, 'Internal Server Error');
        }
    };
}
