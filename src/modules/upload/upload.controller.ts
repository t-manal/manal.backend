import { Request, Response, NextFunction } from 'express';
import { pipeline } from 'stream';
import { UploadService } from './upload.service';
import { ApiResponse } from '../../utils/api-response';
import { AppError } from '../../utils/app-error';

const service = new UploadService();

export class UploadController {
    async uploadThumbnail(req: Request, res: Response, next: NextFunction) {
        try {
            console.log('[UploadController] req.params:', req.params);
            console.log('[UploadController] req.file:', req.file ? {
                fieldname: req.file.fieldname,
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            } : 'MISSING');

            if (!req.file) throw new AppError('No file uploaded', 400);
            const { courseId } = req.params;
            const result = await service.uploadThumbnail(req.user!.userId, courseId, req.file);
            return ApiResponse.success(res, result, 'Thumbnail uploaded');
        } catch (error) {
            next(error);
        }
    }

    async uploadAvatar(req: Request, res: Response, next: NextFunction) {
        try {
            if (!req.file) throw new AppError('No file uploaded', 400);
            const result = await service.uploadAvatar(req.user!.userId, req.file);
            return ApiResponse.success(res, result, 'Avatar uploaded');
        } catch (error) {
            next(error);
        }
    }

    async uploadPdf(req: Request, res: Response, next: NextFunction) {
        try {
            if (!req.file) throw new AppError('No file uploaded', 400);
            const { lessonId } = req.params;
            const { title, isSecure } = req.body;
            const result = await service.uploadLessonPdf(req.user!.userId, lessonId, req.file, title, isSecure);
            return ApiResponse.success(res, result, 'PDF uploaded');
        } catch (error) {
            next(error);
        }
    }

    async renderPage(req: Request, res: Response, next: NextFunction) {
        try {
            const { lessonId, pageNumber } = req.params;
            const { stream, contentType, filename } = await service.getRenderedPage(req.user!.userId, lessonId, parseInt(pageNumber, 10));

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
            // Cache Policy for Rendered Pages: Private
            res.setHeader('Cache-Control', 'private, max-age=3600'); 

            pipeline(stream, res, (err) => {
                if (err && !res.headersSent) {
                    next(err);
                }
                // If headersSent is true, the response is already sent, don't call next()
            });
        } catch (error) {
            if (!res.headersSent) {
                next(error);
            }
        }
    }

    async getMetadata(req: Request, res: Response, next: NextFunction) {
        try {
            const { assetId } = req.params;
            const result = await service.getDocumentMetadata(req.user!.userId, assetId);
            return ApiResponse.success(res, result, 'Document metadata retrieved');
        } catch (error) {
            next(error);
        }
    }

    async initVideoUpload(req: Request, res: Response, next: NextFunction) {
        try {
            const { title } = req.body;
            if (!title) throw new AppError('Title is required', 400);

            const result = await service.initVideoUpload(title);
            return ApiResponse.success(res, result, 'Video upload initialized');
        } catch (error) {
            next(error);
        }
    }

    async uploadFile(req: Request, res: Response, next: NextFunction) {
        try {
            console.log('[UploadController] uploadFile req.file:', req.file ? {
                fieldname: req.file.fieldname,
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            } : 'MISSING');
            console.log('[UploadController] uploadFile req.body:', req.body);

            if (!req.file) throw new AppError('No file uploaded', 400);
            const result = await service.uploadFile(req.user!.userId, req.file);
            return ApiResponse.success(res, result, 'File uploaded');
        } catch (error) {
            next(error);
        }
    }

    async securePdf(req: Request, res: Response, next: NextFunction) {
        try {
            const { assetId } = req.params;
            const { stream, contentType, filename } = await service.getSecurePdf(req.user!.userId, assetId);

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
            res.setHeader('X-Content-Type-Options', 'nosniff');

            pipeline(stream, res, (err) => {
                if (err && !res.headersSent) next(err);
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /uploads/bunny/prepare
     * 
     * Prepares credentials for direct video upload to Bunny Stream.
     * The video file goes directly from browser to Bunny CDN.
     */
    async prepareBunnyUpload(req: Request, res: Response, next: NextFunction) {
        try {
            const { title, partLessonId } = req.query;
            
            if (!title || typeof title !== 'string') {
                throw new AppError('Title is required', 400);
            }

            // Import Bunny Stream service
            const { BunnyStreamService } = await import('../../services/video/bunny-stream.service');
            const { BunnyWebhookController } = await import('../webhooks/bunny-webhook.controller');
            
            const bunnyService = new BunnyStreamService();
            const credentials = await bunnyService.createVideo(title);

            // Register for webhook matching if partLessonId provided
            if (partLessonId && typeof partLessonId === 'string') {
                BunnyWebhookController.registerPendingUpload(credentials.videoId, partLessonId);
            }

            return ApiResponse.success(res, credentials, 'Bunny upload credentials generated');
        } catch (error) {
            next(error);
        }
    }
}
