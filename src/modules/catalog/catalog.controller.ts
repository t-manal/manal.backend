import { Request, Response, NextFunction } from 'express';
import { CatalogService } from './catalog.service';
import { courseQuerySchema, createUniversitySchema } from './catalog.schema';
import { ApiResponse } from '../../utils/api-response';
import { AppError } from '../../utils/app-error';

// Phase 8: V2 Simplified Catalog Controller
// Major/Subject layer REMOVED

const catalogService = new CatalogService();

export class CatalogController {
    async getUniversities(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await catalogService.getUniversities();
            return ApiResponse.success(res, data);
        } catch (error) {
            next(error);
        }
    }

    async getUniversity(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await catalogService.getUniversity(req.params.id);
            return ApiResponse.success(res, data);
        } catch (error) {
            next(error);
        }
    }

    async createUniversity(req: Request, res: Response, next: NextFunction) {
        try {
            const input = createUniversitySchema.parse(req.body);
            const data = await catalogService.createUniversity({
                ...input,
                logo: input.logo ?? undefined
            });
            return ApiResponse.success(res, data, 'University created successfully', 201);
        } catch (error) {
            next(error);
        }
    }

    async deleteUniversity(req: Request, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const data = await catalogService.deleteUniversityCascade(id);
            return ApiResponse.success(res, data, 'University and related data deleted successfully');
        } catch (error) {
            next(error);
        }
    }

    // Admin endpoint - includes drafts
    async getUniversityCourses(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await catalogService.getUniversityCourses(req.params.id);
            return ApiResponse.success(res, data);
        } catch (error) {
            next(error);
        }
    }

    // Public endpoint for Student Frontend - Phase 8: V2 Simplification
    async getUniversityPublicCourses(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await catalogService.getUniversityPublicCourses(req.params.id);
            return ApiResponse.success(res, data);
        } catch (error) {
            next(error);
        }
    }

    async getCourses(req: Request, res: Response, next: NextFunction) {
        try {
            const query = courseQuerySchema.parse(req.query);
            const data = await catalogService.searchCourses(query);
            return ApiResponse.success(res, data);
        } catch (error) {
            next(error);
        }
    }

    async getCourse(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await catalogService.getCourseDetailsPublic(req.params.id);
            return ApiResponse.success(res, data);
        } catch (error) {
            next(error);
        }
    }

    async uploadUniversityLogo(req: Request, res: Response, next: NextFunction) {
        try {
            if (!req.file) {
                throw new AppError('No file provided', 400);
            }
            const { id } = req.params;
            const data = await catalogService.uploadUniversityLogo(id, req.file);
            return ApiResponse.success(res, data, 'Logo uploaded successfully');
        } catch (error) {
            next(error);
        }
    }

    async deleteUniversityLogo(req: Request, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            await catalogService.deleteUniversityLogo(id);
            return ApiResponse.success(res, { success: true }, 'Logo deleted successfully');
        } catch (error) {
            next(error);
        }
    }
}
