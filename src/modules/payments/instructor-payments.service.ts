import prisma from '../../config/prisma';
import { PaymentStatus, PaymentProvider } from '@prisma/client';

interface ListPaymentsQuery {
    page: number;
    limit: number;
    courseId?: string;
    status?: PaymentStatus;
    provider?: PaymentProvider;
}

export class InstructorPaymentsService {
    async getRevenueSummary(instructorId: string) {
        // 1. Calculate Total Revenue (Lifetime)
        const totalRevenueAgg = await prisma.paymentRecord.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                status: 'COMPLETED',
                course: {
                    instructorId,
                },
            },
        });

        // 2. Calculate Last 14 Days Series
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

        const recentPayments = await prisma.paymentRecord.findMany({
            where: {
                status: 'COMPLETED',
                course: {
                    instructorId,
                },
                createdAt: {
                    gte: fourteenDaysAgo,
                },
            },
            select: {
                amount: true,
                createdAt: true,
            },
            orderBy: {
                createdAt: 'asc',
            },
        });

        return {
            totalRevenue: totalRevenueAgg._sum.amount?.toNumber() || 0,
            currency: 'SAR', // System currency is SAR
            series: recentPayments.map(p => ({
                amount: p.amount.toNumber(),
                date: p.createdAt,
            })),
        };
    }

    async listPayments(instructorId: string, query: ListPaymentsQuery) {
        const { page, limit, courseId, status, provider } = query;
        const skip = (page - 1) * limit;

        const where: any = {
            course: {
                instructorId,
            },
        };

        if (courseId) where.courseId = courseId;
        if (status) where.status = status;
        if (provider) where.provider = provider;

        const [total, payments] = await Promise.all([
            prisma.paymentRecord.count({ where }),
            prisma.paymentRecord.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            username: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                    course: {
                        select: {
                            id: true,
                            title: true,
                            slug: true,
                            university: {
                                select: {
                                    name: true,
                                },
                            },
                        },
                    },
                },
            }),
        ]);

        return {
            payments,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
}
