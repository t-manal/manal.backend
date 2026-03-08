import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/prisma';
import { ApiResponse } from '../../utils/api-response';
import { TrailerService } from './trailer.service';

const trailerService = new TrailerService();

export class TrailerPublicController {
    async getCoursesWithTrailer(req: Request, res: Response, next: NextFunction) {
        try {
            const courses = await prisma.course.findMany({
                where: {
                    isPublished: true,
                    trailerEnabled: true,
                },
                select: {
                    id: true,
                    title: true,
                    thumbnail: true,
                    description: true,
                    price: true,
                    university: {
                        select: {
                            id: true,
                            name: true,
                            logo: true,
                        },
                    },
                    _count: {
                        select: {
                            enrollments: true,
                            lectures: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
                take: 100,
            });

            return ApiResponse.success(res, courses);
        } catch (error) {
            next(error);
        }
    }

    async getCourseTrailer(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await trailerService.getTrailerForStudent(req.params.courseId);
            return ApiResponse.success(res, data);
        } catch (error) {
            next(error);
        }
    }
}

