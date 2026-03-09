import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import { ApiResponse } from '../../utils/api-response';

export const trailerPublicController = {

    getCoursesWithTrailer: async (req: Request, res: Response) => {
        try {
            const courses = await prisma.course.findMany({
                where: { trailerEnabled: true, isPublished: true },
                select: {
                    id: true, title: true, thumbnail: true, description: true, price: true,
                    university: { select: { id: true, name: true } },
                    _count: { select: { enrollments: true } },
                },
            });
            return ApiResponse.success(res, courses);
        } catch (err) {
            return ApiResponse.error(res, err, 'Failed to fetch trailer courses', 500);
        }
    },

    getCourseTrailer: async (req: Request, res: Response) => {
        try {
            const { courseId } = req.params;
            const course = await prisma.course.findUnique({
                where: { id: courseId },
                include: {
                    university: { select: { id: true, name: true, logo: true } },
                    trailerSections: {
                        orderBy: { order: 'asc' },
                        include: {
                            lecture: {
                                include: {
                                    parts: {
                                        orderBy: { order: 'asc' },
                                        include: {
                                            lessons: { orderBy: { order: 'asc' } },
                                            files: { orderBy: { order: 'asc' } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    lectures: {
                        orderBy: { order: 'asc' },
                        select: { id: true, title: true, order: true, _count: { select: { parts: true } } },
                    },
                },
            });

            if (!course) return ApiResponse.error(res, null, 'Course not found', 404);
            if (!course.trailerEnabled || !course.isPublished)
                return ApiResponse.error(res, null, 'Trailer not available for this course', 404);

            const trailerLectures = course.trailerSections.map(({ lecture, order }) => ({
                id: lecture.id,
                title: lecture.title,
                order,
                parts: lecture.parts,
                // Flat assets list for the watch page sidebar
                assets: lecture.parts.flatMap((part) =>
                    [
                        ...part.lessons.map((lesson) => ({
                            id: lesson.id,
                            title: lesson.title,
                            type: 'VIDEO' as const,
                            bunnyVideoId: lesson.video,
                            lessonId: part.id,
                            lectureId: lecture.id,
                        })),
                        ...part.files.map((file) => ({
                            id: file.id,
                            title: file.title,
                            type: file.type as string,
                            storageKey: file.storageKey,
                            lessonId: part.id,
                            lectureId: lecture.id,
                        })),
                    ]
                ),
            }));

            return ApiResponse.success(res, {
                course: {
                    id: course.id,
                    title: course.title,
                    thumbnail: course.thumbnail,
                    description: course.description,
                    price: course.price,
                    university: course.university,
                },
                trailerLectures,
                courseOutline: course.lectures,
            });
        } catch (err) {
            console.error(err);
            return ApiResponse.error(res, err, 'Failed to fetch course trailer', 500);
        }
    },
};
