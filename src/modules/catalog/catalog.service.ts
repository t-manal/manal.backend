import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import { CourseQueryParams } from './catalog.schema';
import { AppError } from '../../utils/app-error';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { uploadToBunnyStorage, deleteFromBunnyStorage, toPublicCdnUrl, extractStorageKeyFromLogoUrl } from '../../services/storage/bunny-images.service';

// Phase 8: V2 Simplified Catalog Service
// Major/Subject layer REMOVED - Direct University → Course flow

export class CatalogService {
    async getUniversities() {
        return prisma.university.findMany({
            orderBy: { name: 'asc' },
            take: 100, // POLICY: Hard cap to prevent unbounded results
        });
    }

    async getUniversity(id: string) {
        const university = await prisma.university.findUnique({
            where: { id },
        });

        if (!university) {
            throw new AppError('University not found', 404);
        }

        return university;
    }

    // Admin endpoint - includes drafts
    async getUniversityCourses(universityId: string) {
        return prisma.course.findMany({
            where: { universityId: universityId }, // POLICY: Admin view includes drafts
            select: {
                id: true,
                title: true,
                slug: true,
                price: true,
                isFeatured: true,
                isFree: true,
                isPublished: true,
                instructor: {
                    select: {
                        firstName: true,
                        lastName: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 100, // POLICY: Hard cap to prevent unbounded results
        });
    }

    // Public endpoint for Student Frontend (Phase 8: V2 Simplification)
    // Returns only published courses for university - no auth required
    async getUniversityPublicCourses(universityId: string) {
        return prisma.course.findMany({
            where: { 
                universityId: universityId,
                isPublished: true // POLICY: Public view - published only
            },
            select: {
                id: true,
                title: true,
                slug: true,
                price: true,
                isFeatured: true,
                isFree: true,
                instructor: {
                    select: {
                        firstName: true,
                        lastName: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 100, // POLICY: Hard cap to prevent unbounded results
        });
    }

    async createUniversity(data: { name: string; logo?: string }) {
        return prisma.university.create({ data });
    }

    async deleteUniversityCascade(universityId: string) {
        const university = await this.getUniversity(universityId);

        return prisma.$transaction(async (tx) => {
            const courses = await tx.course.findMany({
                where: { universityId },
                select: { id: true },
            });

            const courseIds = courses.map((course) => course.id);

            let deletedPayments = 0;
            let deletedEnrollments = 0;
            let deletedCourses = 0;

            if (courseIds.length > 0) {
                const paymentDeletion = await tx.paymentRecord.deleteMany({
                    where: { courseId: { in: courseIds } },
                });
                deletedPayments = paymentDeletion.count;

                const enrollmentDeletion = await tx.enrollment.deleteMany({
                    where: { courseId: { in: courseIds } },
                });
                deletedEnrollments = enrollmentDeletion.count;

                const courseDeletion = await tx.course.deleteMany({
                    where: { id: { in: courseIds } },
                });
                deletedCourses = courseDeletion.count;
            }

            await tx.university.delete({ where: { id: universityId } });

            return {
                universityId,
                universityName: university.name,
                deleted: {
                    courses: deletedCourses,
                    enrollments: deletedEnrollments,
                    paymentRecords: deletedPayments,
                },
            };
        });
    }

    async getCourseDetailsPublic(courseId: string) {
        const course = await prisma.course.findFirst({
            where: {
                id: courseId,
                isPublished: true,
            },
            select: {
                id: true,
                title: true,
                description: true,
                price: true,
                isFeatured: true,
                isFree: true,
                updatedAt: true,
                instructor: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        bio: true,
                    }
                },
                university: {
                    select: {
                        id: true,
                        name: true,
                        logo: true,
                    }
                },
                lectures: {
                    orderBy: { order: 'asc' },
                    select: {
                        id: true,
                        title: true,
                        parts: {
                            orderBy: { order: 'asc' },
                            select: {
                                id: true,
                                title: true,
                                files: {
                                    orderBy: { order: 'asc' },
                                    select: {
                                        id: true,
                                        type: true,
                                        title: true,
                                        order: true,
                                    }
                                },
                                lessons: {
                                    orderBy: { order: 'asc' },
                                    select: {
                                        id: true,
                                        title: true,
                                        order: true,
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!course) {
            throw new AppError('Course not found', 404);
        }

        return course;
    }

    async searchCourses(params: CourseQueryParams) {
        const { q, universityId, isFeatured, isFree, page, limit, sort } = params;

        const skip = (page - 1) * limit;

        const where: Prisma.CourseWhereInput = {
            isPublished: true,
            ...(q && {
                // POLICY: Path D Mitigation - Title-only search to prevent full table scan on description
                title: { contains: q, mode: 'insensitive' }
            }),
            ...(universityId && { universityId }), // V2: Direct filter by universityId
            ...(isFeatured !== undefined && { isFeatured }),
            ...(isFree !== undefined && { isFree }),
        };

        const orderBy: Prisma.CourseOrderByWithRelationInput[] = [];
        if (sort === 'featured') {
            orderBy.push({ isFeatured: 'desc' });
        }
        orderBy.push({ createdAt: 'desc' });

        const [total, courses] = await Promise.all([
            prisma.course.count({ where }),
            prisma.course.findMany({
                where,
                select: {
                    id: true,
                    title: true,
                    slug: true,
                    price: true,
                    isFeatured: true,
                    isFree: true,
                    updatedAt: true,
                },
                skip,
                take: limit,
                orderBy,
            }),
        ]);

        return {
            courses,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async updateUniversityLogo(universityId: string, logoUrl: string) {
        return prisma.university.update({
            where: { id: universityId },
            data: { logo: logoUrl }
        });
    }

    async uploadUniversityLogo(universityId: string, file: Express.Multer.File) {
        // 1. Validate university exists
        const university = await this.getUniversity(universityId);

        // 2. Validate file type
        const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
        if (!allowedMimes.includes(file.mimetype)) {
            throw new AppError('Invalid file type. Allowed: PNG, JPEG, WEBP, SVG', 400);
        }

        // 3. Process image
        let buffer = file.buffer;
        let contentType = file.mimetype;
        let ext = file.mimetype.split('/')[1];
        if (ext === 'svg+xml') ext = 'svg';

        if (file.mimetype !== 'image/svg+xml') {
            buffer = await sharp(file.buffer)
                .rotate()
                .resize({ width: 512, withoutEnlargement: true })
                .webp({ quality: 80 })
                .toBuffer();

            contentType = 'image/webp';
            ext = 'webp';
        }

        // 4. Create storage key
        const BUNNY_STORAGE_UPLOAD_FOLDER = process.env.BUNNY_STORAGE_UPLOAD_FOLDER || 'universities/logos';
        const storageKey = `${BUNNY_STORAGE_UPLOAD_FOLDER}/${universityId}/logo-${uuidv4()}.${ext}`;

        // 5. Upload to Bunny
        await uploadToBunnyStorage(buffer, contentType, storageKey);
        const publicUrl = toPublicCdnUrl(storageKey);

        const oldLogoUrl = university.logo;

        // 6. Update DB
        const updatedUniversity = await prisma.university.update({
            where: { id: universityId },
            data: { logo: publicUrl }
        });

        // 7. Cleanup old logo
        if (oldLogoUrl) {
            const oldKey = extractStorageKeyFromLogoUrl(oldLogoUrl);
            if (oldKey) {
                deleteFromBunnyStorage(oldKey).catch(err => {
                    console.error('Failed to delete old logo:', err);
                });
            }
        }

        return {
            url: publicUrl,
            universityId: updatedUniversity.id
        };
    }

    async deleteUniversityLogo(universityId: string) {
        const university = await this.getUniversity(universityId);

        if (university.logo) {
            const storageKey = extractStorageKeyFromLogoUrl(university.logo);
            if (storageKey) {
                await deleteFromBunnyStorage(storageKey);
            }
        }

        await prisma.university.update({
            where: { id: universityId },
            data: { logo: null }
        });

        return { success: true };
    }
}
