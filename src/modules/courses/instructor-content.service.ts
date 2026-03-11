import prisma from '../../config/prisma';
import { AppError } from '../../utils/app-error';
import {
    CreateCourseInput,
    UpdateCourseInput,
    CreateSectionInput,
    UpdateSectionInput,
    CreateLessonInput,
    UpdateLessonInput,
    CreateAssetInput,
    UpdateAssetInput
} from './instructor-content.schema';
import { PartFileType, PaymentStatus } from '@prisma/client';

// Phase 8: V2 Simplified - All Subject/Major references removed

export class InstructorContentService {
    private static readonly LECTURE_ASSET_PART_PREFIX = '__lecture_assets__:';

    private getLectureAssetPartTitle(lectureId: string) {
        return `${InstructorContentService.LECTURE_ASSET_PART_PREFIX}${lectureId}`;
    }

    private isLectureAssetPartTitle(title: string) {
        return title.startsWith(InstructorContentService.LECTURE_ASSET_PART_PREFIX);
    }

    private mapPartAssets(part: {
        lessons: Array<{ id: string; title: string; video: string; order: number }>;
        files: Array<{ id: string; title: string; storageKey: string; order: number; type?: string; displayName?: string }>;
    }) {
        return [
            ...part.lessons.map((pl) => ({
                id: pl.id,
                title: pl.title,
                type: 'VIDEO',
                bunnyVideoId: pl.video,
                order: pl.order,
                isPreview: false
            })),
            ...part.files.map((pf) => ({
                id: pf.id,
                title: pf.displayName || pf.title,
                type: pf.type === 'PPTX' ? 'PPTX' : 'PDF',
                storageKey: pf.storageKey,
                order: pf.order,
                isPreview: false
            }))
        ].sort((a, b) => a.order - b.order);
    }

    private async getOrCreateLectureAssetPart(lectureId: string) {
        const existingPart = await prisma.part.findFirst({
            where: {
                lectureId,
                title: this.getLectureAssetPartTitle(lectureId)
            },
            include: {
                lessons: { orderBy: { order: 'asc' } },
                files: { orderBy: { order: 'asc' } }
            }
        });

        if (existingPart) {
            return existingPart;
        }

        const maxPartOrder = await prisma.part.findFirst({
            where: { lectureId },
            orderBy: { order: 'desc' },
            select: { order: true }
        });

        return prisma.part.create({
            data: {
                lectureId,
                title: this.getLectureAssetPartTitle(lectureId),
                order: (maxPartOrder?.order || 0) + 1
            },
            include: {
                lessons: { orderBy: { order: 'asc' } },
                files: { orderBy: { order: 'asc' } }
            }
        });
    }

    // Courses
    async createCourse(instructorId: string, data: CreateCourseInput) {
        const slug = data.slug || data.title.toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/--+/g, '-')
            .trim() + '-' + Math.random().toString(36).substring(2, 7);

        return prisma.course.create({
            data: {
                title: data.title,
                slug,
                description: data.description,
                price: data.price,
                thumbnail: data.thumbnail,
                instructorId,
                universityId: data.universityId, // V2: Required
                isPublished: data.isPublished || false,
                isFeatured: data.isFeatured || false,
                isFree: data.isFree || false,
            },
        });
    }

    async updateCourse(instructorId: string, courseId: string, data: UpdateCourseInput) {
        await this.checkCourseOwnership(instructorId, courseId);
        return prisma.course.update({
            where: { id: courseId },
            data,
        });
    }

    async deleteCourse(instructorId: string, courseId: string) {
        await this.checkCourseOwnership(instructorId, courseId);
        return prisma.course.delete({
            where: { id: courseId },
        });
    }

    // Sections (Mapped to Lectures)
    async createSection(instructorId: string, courseId: string, data: CreateSectionInput) {
        await this.checkCourseOwnership(instructorId, courseId);
        
        const lecture = await prisma.lecture.create({
            data: {
                title: data.title,
                order: data.order,
                courseId,
            },
        });

        return {
            id: lecture.id,
            title: lecture.title,
            order: lecture.order,
            courseId: lecture.courseId,
            lessons: []
        };
    }

    async ensureLectureAssetContainer(instructorId: string, sectionId: string) {
        const lecture = await prisma.lecture.findUnique({
            where: { id: sectionId },
            include: { course: true }
        });

        if (!lecture) throw new AppError('Section not found', 404);
        if (lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);

        const lectureAssetPart = await this.getOrCreateLectureAssetPart(lecture.id);

        return {
            id: lectureAssetPart.id,
            title: 'Lecture Assets',
            order: lectureAssetPart.order,
            assets: this.mapPartAssets(lectureAssetPart),
            isLectureAssetContainer: true
        };
    }

    async moveLessonAssetsToLecture(instructorId: string, lessonId: string) {
        const part = await prisma.part.findUnique({
            where: { id: lessonId },
            include: {
                lecture: { include: { course: true } },
                lessons: { orderBy: { order: 'asc' } },
                files: { orderBy: { order: 'asc' } }
            }
        });

        if (!part) throw new AppError('Lesson not found', 404);
        if (part.lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
        if (this.isLectureAssetPartTitle(part.title)) {
            throw new AppError('Lecture asset containers are already inside the lecture', 400);
        }

        const lectureAssetPart = await this.getOrCreateLectureAssetPart(part.lectureId);
        const directAssets = [
            ...part.lessons.map((asset) => ({ kind: 'lesson' as const, id: asset.id, order: asset.order })),
            ...part.files.map((asset) => ({ kind: 'file' as const, id: asset.id, order: asset.order }))
        ].sort((a, b) => a.order - b.order);

        if (directAssets.length === 0) {
            return { movedCount: 0, targetPartId: lectureAssetPart.id };
        }

        let nextOrder = await this.getNextAssetOrder(lectureAssetPart.id);

        await prisma.$transaction(async (tx) => {
            for (const asset of directAssets) {
                if (asset.kind === 'lesson') {
                    await tx.partLesson.update({
                        where: { id: asset.id },
                        data: {
                            partId: lectureAssetPart.id,
                            order: nextOrder
                        }
                    });
                } else {
                    await tx.partFile.update({
                        where: { id: asset.id },
                        data: {
                            partId: lectureAssetPart.id,
                            order: nextOrder
                        }
                    });
                }

                nextOrder += 1;
            }
        });

        return {
            movedCount: directAssets.length,
            targetPartId: lectureAssetPart.id
        };
    }

    async updateSection(instructorId: string, sectionId: string, data: UpdateSectionInput) {
        const lecture = await prisma.lecture.findUnique({
            where: { id: sectionId },
            include: { course: true }
        });

        if (lecture) {
            if (lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
            return prisma.lecture.update({
                where: { id: sectionId },
                data: { title: data.title, order: data.order }
            });
        }

        throw new AppError('Section not found', 404);
    }

    async deleteSection(instructorId: string, sectionId: string) {
        const lecture = await prisma.lecture.findUnique({
            where: { id: sectionId },
            include: { course: true }
        });

        if (lecture) {
            if (lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
            return prisma.lecture.delete({ where: { id: sectionId } });
        }

        throw new AppError('Section not found', 404);
    }

    // Lessons (Mapped to Parts)
    async createLesson(instructorId: string, sectionId: string, data: CreateLessonInput) {
        const lecture = await prisma.lecture.findUnique({
            where: { id: sectionId },
            include: { course: true }
        });

        if (lecture) {
            if (lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
            const part = await prisma.part.create({
                data: {
                    title: data.title,
                    order: data.order,
                    lectureId: sectionId
                }
            });
            return {
                id: part.id,
                title: part.title,
                order: part.order,
                assets: []
            };
        }

        throw new AppError('Section not found', 404);
    }

    async updateLesson(instructorId: string, lessonId: string, data: UpdateLessonInput) {
        const part = await prisma.part.findUnique({
            where: { id: lessonId },
            include: { lecture: { include: { course: true } } }
        });

        if (part) {
            if (part.lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
            const isLectureAssetContainer = this.isLectureAssetPartTitle(part.title);

            if (isLectureAssetContainer) {
                if (data.lectureId && data.lectureId !== part.lectureId) {
                    throw new AppError('Lecture asset containers cannot be moved', 400);
                }

                if (data.title && data.title !== part.title) {
                    throw new AppError('Lecture asset containers cannot be renamed', 400);
                }
            }

            let targetLectureId = part.lectureId;
            let nextOrder = data.order ?? part.order;
            let shouldResetParent = false;
            let targetLectureMaxOrder = part.order;

            if (data.lectureId && data.lectureId !== part.lectureId) {
                const targetLecture = await prisma.lecture.findUnique({
                    where: { id: data.lectureId },
                    include: { course: true }
                });

                if (!targetLecture) throw new AppError('Target section not found', 404);
                if (targetLecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
                if (targetLecture.courseId !== part.lecture.courseId) {
                    throw new AppError('Lesson can only be moved within the same course', 400);
                }

                targetLectureId = targetLecture.id;
                shouldResetParent = true;

                const maxTargetOrder = await prisma.part.findFirst({
                    where: { lectureId: targetLectureId },
                    orderBy: { order: 'desc' },
                    select: { order: true }
                });

                targetLectureMaxOrder = maxTargetOrder?.order || 0;

                if (typeof data.order !== 'number') {
                    nextOrder = targetLectureMaxOrder + 1;
                }
            }

            const descendantIds = targetLectureId !== part.lectureId
                ? await this.getDescendantPartIds(lessonId)
                : [];

            return prisma.$transaction(async (tx) => {
                const updatedPart = await tx.part.update({
                    where: { id: lessonId },
                    data: {
                        title: data.title,
                        order: nextOrder,
                        lectureId: targetLectureId,
                        parentPartId: shouldResetParent ? null : undefined
                    }
                });

                if (descendantIds.length > 0) {
                    let descendantOrder = Math.max(nextOrder, targetLectureMaxOrder) + 1;

                    for (const descendantId of descendantIds) {
                        await tx.part.update({
                            where: { id: descendantId },
                            data: {
                                lectureId: targetLectureId,
                                order: descendantOrder
                            }
                        });
                        descendantOrder += 1;
                    }
                }

                return updatedPart;
            });
        }

        throw new AppError('Lesson not found', 404);
    }

    async deleteLesson(instructorId: string, lessonId: string) {
        const part = await prisma.part.findUnique({
            where: { id: lessonId },
            include: { lecture: { include: { course: true } } }
        });

        if (part) {
            if (part.lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
            return prisma.part.delete({ where: { id: lessonId } });
        }

        throw new AppError('Lesson not found', 404);
    }

    // Assets (PartLesson for VIDEO, PartFile for PDF/PPTX)
    async createAsset(instructorId: string, lessonId: string, data: CreateAssetInput) {
        const part = await prisma.part.findUnique({
            where: { id: lessonId },
            include: { lecture: { include: { course: true } } }
        });

        if (part) {
            if (part.lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
            
            if (data.type === 'VIDEO' && data.bunnyVideoId) {
                return prisma.partLesson.create({
                    data: {
                        title: data.title,
                        video: data.bunnyVideoId,
                        order: data.order,
                        partId: lessonId
                    }
                });
            }

            if (data.type === 'PDF' && data.storageKey) {
                return prisma.partFile.create({
                    data: {
                        title: data.title,
                        storageKey: data.storageKey,
                        type: PartFileType.PDF,
                        order: data.order,
                        partId: lessonId
                    }
                });
            }

            if (data.type === 'PPTX' && data.storageKey) {
                return prisma.partFile.create({
                    data: {
                        title: data.title,
                        storageKey: data.storageKey,
                        type: PartFileType.PPTX,
                        order: data.order,
                        partId: lessonId
                    }
                });
            }

            throw new AppError(`Asset type ${data.type} requires ${data.type === 'VIDEO' ? 'bunnyVideoId' : 'storageKey'}`, 400);
        }

        throw new AppError('Lesson not found', 404);
    }

    async updateAsset(instructorId: string, assetId: string, data: UpdateAssetInput) {
        // 1. PartLesson (Video)
        const pl = await prisma.partLesson.findUnique({
            where: { id: assetId },
            include: { part: { include: { lecture: { include: { course: true } } } } }
        });
        if (pl) {
            if (pl.part.lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
            let targetPartId = pl.partId;
            let nextOrder = data.order ?? pl.order;

            if (data.partId && data.partId !== pl.partId) {
                const targetPart = await this.getValidatedTargetPart(
                    instructorId,
                    pl.part.lecture.courseId,
                    data.partId
                );

                targetPartId = targetPart.id;

                if (typeof data.order !== 'number') {
                    nextOrder = await this.getNextAssetOrder(targetPartId);
                }
            }

            return prisma.partLesson.update({
                where: { id: assetId },
                data: { 
                    title: data.title, 
                    order: nextOrder,
                    video: data.bunnyVideoId || pl.video,
                    partId: targetPartId
                }
            });
        }

        // 2. PartFile (PDF/PPTX)
        const pf = await prisma.partFile.findUnique({
            where: { id: assetId },
            include: { part: { include: { lecture: { include: { course: true } } } } }
        });
        if (pf) {
            if (pf.part.lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
            let targetPartId = pf.partId;
            let nextOrder = data.order ?? pf.order;

            if (data.partId && data.partId !== pf.partId) {
                const targetPart = await this.getValidatedTargetPart(
                    instructorId,
                    pf.part.lecture.courseId,
                    data.partId
                );

                targetPartId = targetPart.id;

                if (typeof data.order !== 'number') {
                    nextOrder = await this.getNextAssetOrder(targetPartId);
                }
            }

            return prisma.partFile.update({
                where: { id: assetId },
                data: {
                    title: data.title,
                    order: nextOrder,
                    storageKey: data.storageKey || pf.storageKey,
                    partId: targetPartId
                }
            });
        }

        throw new AppError('Asset not found', 404);
    }

    async deleteAsset(instructorId: string, assetId: string) {
        const pl = await prisma.partLesson.findUnique({ where: { id: assetId }, include: { part: { include: { lecture: { include: { course: true } } } } } });
        if (pl) {
            if (pl.part.lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
            return prisma.partLesson.delete({ where: { id: assetId } });
        }

        const pf = await prisma.partFile.findUnique({ where: { id: assetId }, include: { part: { include: { lecture: { include: { course: true } } } } } });
        if (pf) {
            if (pf.part.lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
            return prisma.partFile.delete({ where: { id: assetId } });
        }

        throw new AppError('Asset not found', 404);
    }

    // Helpers
    private async getDescendantPartIds(rootPartId: string) {
        const descendantIds: string[] = [];
        let frontier = [rootPartId];

        while (frontier.length > 0) {
            const children = await prisma.part.findMany({
                where: { parentPartId: { in: frontier } },
                select: { id: true }
            });

            frontier = children.map((child) => child.id);
            descendantIds.push(...frontier);
        }

        return descendantIds;
    }

    private async getValidatedTargetPart(instructorId: string, currentCourseId: string, targetPartId: string) {
        const targetPart = await prisma.part.findUnique({
            where: { id: targetPartId },
            include: { lecture: { include: { course: true } } }
        });

        if (!targetPart) throw new AppError('Target lesson not found', 404);
        if (targetPart.lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);
        if (targetPart.lecture.courseId !== currentCourseId) {
            throw new AppError('Asset can only be moved within the same course', 400);
        }

        return targetPart;
    }

    private async getNextAssetOrder(partId: string) {
        const [maxLesson, maxFile] = await Promise.all([
            prisma.partLesson.findFirst({
                where: { partId },
                orderBy: { order: 'desc' },
                select: { order: true }
            }),
            prisma.partFile.findFirst({
                where: { partId },
                orderBy: { order: 'desc' },
                select: { order: true }
            })
        ]);

        return Math.max(maxLesson?.order || 0, maxFile?.order || 0) + 1;
    }

    private async checkCourseOwnership(instructorId: string, courseId: string) {
        const course = await prisma.course.findUnique({
            where: { id: courseId },
        });
        if (!course || course.instructorId !== instructorId) {
            throw new AppError('Course not found or access denied', 404);
        }
    }

    async getCoursesByInstructor(instructorId: string) {
        return prisma.course.findMany({
            where: { instructorId },
            include: {
                university: true // V2: Direct university relation
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    async getCourseById(instructorId: string, courseId: string) {
        const course = await prisma.course.findUnique({
            where: { id: courseId },
            include: {
                university: true,
                lectures: {
                    include: {
                        parts: {
                            include: {
                                lessons: { orderBy: { order: 'asc' } },
                                files: { orderBy: { order: 'asc' } }
                            },
                            orderBy: { order: 'asc' }
                        }
                    },
                    orderBy: { order: 'asc' }
                },
                _count: {
                    select: { enrollments: { where: { status: 'ACTIVE' } } }
                }
            }
        });

        if (!course || course.instructorId !== instructorId) {
            throw new AppError('Course not found or access denied', 404);
        }

        // Map to UI shape
        const mappedSections = course.lectures.map((lecture) => {
            const lectureAssetContainer = lecture.parts.find((part: any) => this.isLectureAssetPartTitle(part.title));
            const visibleParts = lecture.parts.filter((part: any) => !this.isLectureAssetPartTitle(part.title));

            return {
                id: lecture.id,
                title: lecture.title,
                order: lecture.order,
                assets: lectureAssetContainer ? this.mapPartAssets(lectureAssetContainer as any) : [],
                assetContainerPartId: lectureAssetContainer?.id,
                lessons: visibleParts.map((part) => ({
                    id: part.id,
                    title: part.title,
                    order: part.order,
                    assets: this.mapPartAssets(part as any),
                    // @ts-ignore
                    subParts: (part.subParts || []).map((sp: any) => ({
                        id: sp.id,
                        title: sp.title,
                        order: sp.order,
                        assets: this.mapPartAssets(sp)
                    }))
                }))
            };
        });

        return {
            ...course,
            sections: mappedSections
        };
    }

    async getLessonById(instructorId: string, lessonId: string) {
        const part = await prisma.part.findUnique({
            where: { id: lessonId },
            include: {
                lessons: { orderBy: { order: 'asc' } },
                files: { orderBy: { order: 'asc' } },
                // @ts-ignore
                subParts: { include: { lessons: { orderBy: { order: 'asc' } }, files: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } },
                lecture: {
                    include: {
                        course: { include: { university: true } }
                    }
                }
            }
        });

        if (part) {
            if (part.lecture.course.instructorId !== instructorId) {
                throw new AppError('Access denied', 403);
            }

            const isLectureAssetContainer = this.isLectureAssetPartTitle(part.title);

            return {
                id: part.id,
                title: isLectureAssetContainer ? 'Lecture Assets' : part.title,
                order: part.order,
                sectionId: part.lectureId,
                isLectureAssetContainer,
                section: {
                    ...part.lecture,
                    course: part.lecture.course
                },
                assets: this.mapPartAssets(part as any),
                // @ts-ignore
                subParts: isLectureAssetContainer ? [] : (part.subParts || []).map((sp: any) => ({
                    id: sp.id,
                    title: sp.title,
                    order: sp.order,
                    assets: this.mapPartAssets(sp)
                }))
            };
        }

        throw new AppError('Lesson not found', 404);
    }

    async getStudentsByInstructor(instructorId: string, params: { page: number; limit: number; q?: string }) {
        // Contract #1: INSTRUCTOR alias = ADMIN. Fetch ALL students.
        const page = params.page || 1;
        const limit = params.limit || 10;
        const skip = (page - 1) * limit;

        const where: any = {
            role: 'STUDENT',
        };

        if (params.q) {
            where.OR = [
                { firstName: { contains: params.q, mode: 'insensitive' } },
                { lastName: { contains: params.q, mode: 'insensitive' } },
                { email: { contains: params.q, mode: 'insensitive' } }
            ];
        }

        const [total, students] = await Promise.all([
            prisma.user.count({ where }),
            prisma.user.findMany({
                where,
                include: {
                    enrollments: {
                        where: { status: 'ACTIVE' },
                        include: {
                            course: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                skip,
                take: limit
            })
        ]);

        // Map to the expected UI shape
        const data = students.map(student => {
            const enrolledCourses = student.enrollments || [];
            return {
                ...student,
                enrolledCoursesCount: enrolledCourses.length,
                courses: enrolledCourses.map(e => ({ id: e.course.id, title: e.course.title }))
            };
        });

        return {
            data,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getStudentDetails(instructorId: string, studentId: string) {
        const enrollments = await prisma.enrollment.findMany({
            where: {
                userId: studentId,
                course: { instructorId },
                status: 'ACTIVE'
            },
            include: {
                course: {
                    include: {
                        lectures: {
                            include: {
                                parts: {
                                    include: {
                                        lessons: { orderBy: { order: 'asc' } },
                                        files: { orderBy: { order: 'asc' } }
                                    },
                                    orderBy: { order: 'asc' }
                                }
                            },
                            orderBy: { order: 'asc' }
                        }
                    }
                }
            }
        });

        if (enrollments.length === 0) {
            throw new AppError('Student not found or not enrolled in your courses', 404);
        }

        const courseIds = enrollments.map(e => e.courseId);
        const allProgress = await prisma.partProgress.findMany({
            where: {
                userId: studentId,
                part: { lecture: { courseId: { in: courseIds } } }
            },
            include: {
                part: { include: { lecture: true } }
            }
        });

        const enrollmentsWithProgress = enrollments.map(enr => {
            // Optimization: Map Lookup O(1)
            const progressMap = new Map<string, any>();
            allProgress.forEach(p => {
                progressMap.set(p.partId, p);
            });

            const sections = enr.course.lectures.map(lecture => ({
                id: lecture.id,
                title: lecture.title,
                order: lecture.order,
                lessons: lecture.parts.map(part => {
                    const progress = progressMap.get(part.id);
                    
                    return {
                        id: part.id,
                        title: part.title,
                        order: part.order,
                        progress: progress ? {
                            completed: progress.isVideoCompleted,
                            lastPosition: progress.lastPositionSeconds
                        } : null,
                        assets: [
                            ...part.lessons.map((pl: { id: string; title: string; video: string; order: number }) => ({
                                id: pl.id,
                                title: pl.title,
                                type: 'VIDEO',
                                bunnyVideoId: pl.video,
                                order: pl.order
                            })),
                            ...part.files.map((pf: { id: string; title: string; storageKey: string; order: number }) => ({
                                id: pf.id,
                                title: pf.title,
                                type: 'PDF',
                                storageKey: pf.storageKey,
                                order: pf.order
                            }))
                        ].sort((a, b) => a.order - b.order),
                // @ts-ignore
                subParts: (part.subParts || []).map((sp: any) => ({ id: sp.id, title: sp.title, order: sp.order, assets: [...sp.lessons.map((pl: any) => ({ id: pl.id, title: pl.title, type: 'VIDEO', bunnyVideoId: pl.video, order: pl.order })), ...sp.files.map((pf: any) => ({ id: pf.id, title: pf.title, type: 'PDF', storageKey: pf.storageKey, order: pf.order }))].sort((a, b) => a.order - b.order) }))
                    };
                })
            }));

            return {
                ...enr,
                course: {
                    ...enr.course,
                    sections: sections
                }
            };
        });



        const user = await prisma.user.findUnique({
            where: { id: studentId }
        });
        return { user, enrollments: enrollmentsWithProgress };
    }

    async getStudentsByCourse(instructorId: string, courseId: string) {
        await this.checkCourseOwnership(instructorId, courseId);
        const enrollments = await prisma.enrollment.findMany({
            where: { courseId, status: 'ACTIVE' },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        phoneNumber: true,
                        avatar: true,
                        courseProgress: {
                            where: { courseId },
                            select: {
                                id: true,
                                lastPartId: true,
                                updatedAt: true
                            }
                        }
                    }
                },
                course: {
                    select: {
                        price: true
                    }
                },
                paymentRecords: {
                    where: {
                        status: PaymentStatus.COMPLETED
                    },
                    select: {
                        amount: true
                    }
                }
            },
            orderBy: {
                enrolledAt: 'desc'
            }
        });

        return enrollments.map(e => ({
            ...e.user,
            progress: e.user.courseProgress?.[0] || null,
            enrollmentId: e.id,
            enrollmentStatus: e.status,
            enrolledAt: e.enrolledAt,
            payment: (() => {
                const price = Number(e.course.price);
                const paidAmount = e.paymentRecords.reduce(
                    (sum: number, p: { amount: unknown }) => sum + Number(p.amount),
                    0
                );
                const remaining = Math.max(0, price - paidAmount);
                const paymentState =
                    paidAmount >= price
                        ? 'FULLY_PAID'
                        : paidAmount > 0
                            ? 'PARTIALLY_PAID'
                            : 'UNPAID';

                return { price, paidAmount, remaining, paymentState };
            })()
        }));
    }
    // Sub-Parts Support
    async createSubLesson(instructorId: string, parentLessonId: string, data: CreateLessonInput) {
        const parent = await prisma.part.findUnique({
            where: { id: parentLessonId },
            include: { lecture: { include: { course: true } } }
        });
        if (!parent) throw new AppError('Parent lesson not found', 404);
        if (parent.lecture.course.instructorId !== instructorId) throw new AppError('Access denied', 403);

        const maxOrderPart = await prisma.part.findFirst({
            where: { lectureId: parent.lectureId },
            orderBy: { order: 'desc' }
        });
        const nextOrder = (maxOrderPart?.order || 0) + 1;

        const subPart = await prisma.part.create({
            data: {
                title: data.title,
                order: nextOrder,
                lectureId: parent.lectureId,
                parentPartId: parentLessonId
            }
        });
        return { id: subPart.id, title: subPart.title, order: subPart.order, assets: [] };
    }
}
