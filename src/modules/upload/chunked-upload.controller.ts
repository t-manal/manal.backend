import { Request, Response, NextFunction } from 'express';
import { ChunkedUploadService } from './chunked-upload.service';
import { ApiResponse } from '../../utils/api-response';
import { AppError } from '../../utils/app-error';
import { z } from 'zod';

const service = new ChunkedUploadService();

// Validation Schemas
const initUploadSchema = z.object({
    filename: z.string().min(1).max(255),
    fileSize: z.number().int().positive(),
    totalChunks: z.number().int().positive(),
    mimeType: z.string().min(1),
    partId: z.string().uuid(),
    isSecure: z.boolean().default(true)
});

const chunkUploadSchema = z.object({
    uploadId: z.string().uuid(),
    chunkIndex: z.coerce.number().int().min(0),
    totalChunks: z.coerce.number().int().positive()
});

const finalizeUploadSchema = z.object({
    uploadId: z.string().uuid(),
    partId: z.string().uuid(),
    isSecure: z.boolean().default(true)
});

export class ChunkedUploadController {
    /**
     * POST /uploads/init
     * Initialize a chunked upload session
     */
    async initUpload(req: Request, res: Response, next: NextFunction) {
        try {
            const input = initUploadSchema.parse(req.body);
            const result = await service.initUpload(req.user!.userId, input);
            return ApiResponse.success(res, result, 'Chunked upload initialized', 201);
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /uploads/chunk
     * Upload a single chunk
     */
    async uploadChunk(req: Request, res: Response, next: NextFunction) {
        try {
            if (!req.file) {
                throw new AppError('No chunk data provided', 400);
            }

            const meta = chunkUploadSchema.parse(req.body);
            
            const result = await service.uploadChunk({
                uploadId: meta.uploadId,
                chunkIndex: meta.chunkIndex,
                totalChunks: meta.totalChunks,
                chunk: req.file.buffer
            });

            return ApiResponse.success(res, result, 'Chunk uploaded');
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /uploads/finalize
     * Assemble all chunks and complete the upload
     */
    async finalizeUpload(req: Request, res: Response, next: NextFunction) {
        try {
            const input = finalizeUploadSchema.parse(req.body);
            const result = await service.finalizeUpload(req.user!.userId, input);
            return ApiResponse.success(res, result, 'Upload finalized');
        } catch (error) {
            next(error);
        }
    }
}
