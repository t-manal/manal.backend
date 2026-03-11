import { Request, Response, NextFunction } from 'express';
import { InstructorContentService } from './instructor-content.service';
import {
    createCourseSchema,
    updateCourseSchema,
    createSectionSchema,
    updateSectionSchema,
    createLessonSchema,
    updateLessonSchema,
    createAssetSchema,
    updateAssetSchema
} from './instructor-content.schema';
import { ApiResponse } from '../../utils/api-response';

const service = new InstructorContentService();

export class InstructorContentController {
    // Course
    async createCourse(req: Request, res: Response, next: NextFunction) {
        try {
            const data = createCourseSchema.parse(req.body);
            const result = await service.createCourse(req.user!.userId, data);
            return ApiResponse.success(res, result, 'Course created', 201);
        } catch (error) {
            next(error);
        }
    }

    async getMyCourses(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await service.getCoursesByInstructor(req.user!.userId);
            return ApiResponse.success(res, result);
        } catch (error) {
            next(error);
        }
    }

    async getCourse(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await service.getCourseById(req.user!.userId, req.params.id);
            return ApiResponse.success(res, result);
        } catch (error) {
            next(error);
        }
    }

    async updateCourse(req: Request, res: Response, next: NextFunction) {
        try {
            const data = updateCourseSchema.parse(req.body);
            const result = await service.updateCourse(req.user!.userId, req.params.id, data);
            return ApiResponse.success(res, result, 'Course updated');
        } catch (error) {
            next(error);
        }
    }

    async deleteCourse(req: Request, res: Response, next: NextFunction) {
        try {
            await service.deleteCourse(req.user!.userId, req.params.id);
            return ApiResponse.success(res, null, 'Course deleted');
        } catch (error) {
            next(error);
        }
    }

    // Section
    async createSection(req: Request, res: Response, next: NextFunction) {
        try {
            const data = createSectionSchema.parse(req.body);
            const result = await service.createSection(req.user!.userId, req.params.courseId, data);
            return ApiResponse.success(res, result, 'Section created', 201);
        } catch (error) {
            next(error);
        }
    }

    async updateSection(req: Request, res: Response, next: NextFunction) {
        try {
            const data = updateSectionSchema.parse(req.body);
            const result = await service.updateSection(req.user!.userId, req.params.id, data);
            return ApiResponse.success(res, result, 'Section updated');
        } catch (error) {
            next(error);
        }
    }

    async deleteSection(req: Request, res: Response, next: NextFunction) {
        try {
            await service.deleteSection(req.user!.userId, req.params.id);
            return ApiResponse.success(res, null, 'Section deleted');
        } catch (error) {
            next(error);
        }
    }

    async ensureLectureAssetContainer(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await service.ensureLectureAssetContainer(req.user!.userId, req.params.id);
            return ApiResponse.success(res, result, 'Lecture asset container ready');
        } catch (error) {
            next(error);
        }
    }

    // Lesson
    async createLesson(req: Request, res: Response, next: NextFunction) {
        try {
            const data = createLessonSchema.parse(req.body);
            const result = await service.createLesson(req.user!.userId, req.params.sectionId, data);
            return ApiResponse.success(res, result, 'Lesson created', 201);
        } catch (error) {
            next(error);
        }
    }

    async updateLesson(req: Request, res: Response, next: NextFunction) {
        try {
            const data = updateLessonSchema.parse(req.body);
            const result = await service.updateLesson(req.user!.userId, req.params.id, data);
            return ApiResponse.success(res, result, 'Lesson updated');
        } catch (error) {
            next(error);
        }
    }

    async deleteLesson(req: Request, res: Response, next: NextFunction) {
        try {
            await service.deleteLesson(req.user!.userId, req.params.id);
            return ApiResponse.success(res, null, 'Lesson deleted');
        } catch (error) {
            next(error);
        }
    }

    async getLesson(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await service.getLessonById(req.user!.userId, req.params.id);
            return ApiResponse.success(res, result);
        } catch (error) {
            next(error);
        }
    }

    async moveLessonAssetsToLecture(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await service.moveLessonAssetsToLecture(req.user!.userId, req.params.id);
            return ApiResponse.success(res, result, 'Lesson assets moved to lecture');
        } catch (error) {
            next(error);
        }
    }

    // Asset
    async createAsset(req: Request, res: Response, next: NextFunction) {
        try {
            const data = createAssetSchema.parse(req.body);
            const result = await service.createAsset(req.user!.userId, req.params.lessonId, data);
            return ApiResponse.success(res, result, 'Asset created', 201);
        } catch (error) {
            next(error);
        }
    }

    async updateAsset(req: Request, res: Response, next: NextFunction) {
        try {
            const data = updateAssetSchema.parse(req.body);
            const result = await service.updateAsset(req.user!.userId, req.params.id, data);
            return ApiResponse.success(res, result, 'Asset updated');
        } catch (error) {
            next(error);
        }
    }

    async deleteAsset(req: Request, res: Response, next: NextFunction) {
        try {
            await service.deleteAsset(req.user!.userId, req.params.id);
            return ApiResponse.success(res, null, 'Asset deleted');
        } catch (error) {
            next(error);
        }
    }

    async getStudents(req: Request, res: Response, next: NextFunction) {
        try {
            // Robust parsing to prevent database crashes
            const rawPage = parseInt(req.query.page as string);
            const rawLimit = parseInt(req.query.limit as string);

            const page = Math.max(1, !isNaN(rawPage) ? rawPage : 1);
            const limit = Math.max(1, Math.min(!isNaN(rawLimit) ? rawLimit : 10, 100)); // Default 10, max 100
            
            const rawQ = req.query.q as string | undefined;
            const q = rawQ?.trim() || undefined;

            const result = await service.getStudentsByInstructor(req.user!.userId, { page, limit, q });
            // Standardizing response: result contains { data, meta }
            return ApiResponse.success(res, result, 'Students fetched');
        } catch (error) {
            next(error);
        }
    }

    async getStudent(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await service.getStudentDetails(req.user!.userId, req.params.id);
            return ApiResponse.success(res, result);
        } catch (error) {
            next(error);
        }
    }

    async getCourseStudents(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await service.getStudentsByCourse(req.user!.userId, req.params.courseId);
            return ApiResponse.success(res, result);
        } catch (error) {
            next(error);
        }
    }
}
