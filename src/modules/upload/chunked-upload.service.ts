import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Redis from 'ioredis';
import prisma from '../../config/prisma';
import { BunnyStorageProvider } from '../../services/storage/bunny-storage.provider';
import { AppError } from '../../utils/app-error';
import { UPLOAD_LIMITS } from '../../config/upload-limits.config';
import { WATERMARK_QUEUE_LABEL } from '../../constants/watermark';

const storage = new BunnyStorageProvider();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface ChunkedUploadSession {
    uploadId: string;
    filename: string;
    fileSize: number;
    mimeType: string;
    totalChunks: number;
    receivedChunks: number[]; // Serialized as Array for JSON
    partId: string;
    isSecure: boolean;
    tempDir: string;
    createdAt: string; // Serialized as string
    userId: string;
}

// Session TTL: 1 hour
const UPLOAD_SESSION_TTL = 60 * 60; 

export interface InitUploadInput {
    filename: string;
    fileSize: number;
    totalChunks: number;
    mimeType: string;
    partId: string;
    isSecure: boolean;
}

export interface ChunkUploadInput {
    uploadId: string;
    chunkIndex: number;
    totalChunks: number;
    chunk: Buffer;
}

export interface FinalizeUploadInput {
    uploadId: string;
    partId: string;
    isSecure: boolean;
}

export class ChunkedUploadService {
    private getRedisKey(uploadId: string): string {
        return `upload:session:${uploadId}`;
    }

    /**
     * Initialize a chunked upload session
     */
    async initUpload(userId: string, input: InitUploadInput): Promise<{ uploadId: string }> {
        // Validate file size
        if (input.fileSize > UPLOAD_LIMITS.MAX_TOTAL_FILE) {
            throw new AppError(`File too large. Maximum size is ${UPLOAD_LIMITS.MAX_TOTAL_FILE / (1024 * 1024)}MB`, 400);
        }

        // Validate chunk count
        const expectedChunks = Math.ceil(input.fileSize / UPLOAD_LIMITS.CHUNK);
        if (input.totalChunks !== expectedChunks) {
            throw new AppError('Invalid chunk count', 400);
        }

        // Validate part ownership
        const part = await prisma.part.findUnique({
            where: { id: input.partId },
            include: { lecture: { include: { course: true } } }
        });

        if (!part) {
            throw new AppError('Part not found', 404);
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        // RBAC UPDATE: Admin is deprecated, Instructor is the authority
        const isInstructor = user?.role === 'INSTRUCTOR';
        const isOwner = part.lecture.course.instructorId === userId;

        if (!isInstructor && !isOwner) {
            throw new AppError('Access denied', 403);
        }

        // Create unique upload ID and temp directory
        const uploadId = uuidv4();
        const tempDir = path.join(os.tmpdir(), `lms-chunked-${uploadId}`);
        await fs.promises.mkdir(tempDir, { recursive: true });

        // Store session in Redis
        const session: ChunkedUploadSession = {
            uploadId,
            filename: input.filename,
            fileSize: input.fileSize,
            mimeType: input.mimeType,
            totalChunks: input.totalChunks,
            receivedChunks: [],
            partId: input.partId,
            isSecure: input.isSecure,
            tempDir,
            createdAt: new Date().toISOString(),
            userId
        };

        await redis.setex(this.getRedisKey(uploadId), UPLOAD_SESSION_TTL, JSON.stringify(session));
        console.log(`[ChunkedUpload] Initialized session ${uploadId} for ${input.filename} (${input.totalChunks} chunks)`);

        return { uploadId };
    }

    /**
     * Upload a single chunk
     */
    async uploadChunk(input: ChunkUploadInput): Promise<{ received: number; total: number }> {
        const key = this.getRedisKey(input.uploadId);
        const data = await redis.get(key);
        
        if (!data) {
            throw new AppError('Upload session not found or expired', 404);
        }

        const session: ChunkedUploadSession = JSON.parse(data);

        // Validate chunk index
        if (input.chunkIndex < 0 || input.chunkIndex >= session.totalChunks) {
            throw new AppError('Invalid chunk index', 400);
        }

        // Validate chunk size (last chunk may be smaller)
        const isLastChunk = input.chunkIndex === session.totalChunks - 1;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const expectedChunkSize = isLastChunk 
            ? session.fileSize % UPLOAD_LIMITS.CHUNK || UPLOAD_LIMITS.CHUNK
            : UPLOAD_LIMITS.CHUNK;

        if (input.chunk.length > UPLOAD_LIMITS.CHUNK) {
            throw new AppError('Chunk too large', 400);
        }

        // Write chunk to temp file
        const chunkPath = path.join(session.tempDir, `chunk-${input.chunkIndex.toString().padStart(5, '0')}`);
        await fs.promises.writeFile(chunkPath, input.chunk);

        // Update received chunks in Redis
        // Using Set in memory logic for checks, but Array for storage
        const receivedSet = new Set(session.receivedChunks);
        receivedSet.add(input.chunkIndex);
        session.receivedChunks = Array.from(receivedSet);

        await redis.setex(key, UPLOAD_SESSION_TTL, JSON.stringify(session));

        console.log(`[ChunkedUpload] Received chunk ${input.chunkIndex + 1}/${session.totalChunks} for ${session.uploadId}`);

        return {
            received: session.receivedChunks.length,
            total: session.totalChunks
        };
    }

    /**
     * Finalize and assemble all chunks
     */
    async finalizeUpload(userId: string, input: FinalizeUploadInput): Promise<{ storageKey: string; assetId: string }> {
        const key = this.getRedisKey(input.uploadId);
        const data = await redis.get(key);

        if (!data) {
            throw new AppError('Upload session not found or expired', 404);
        }

        const session: ChunkedUploadSession = JSON.parse(data);

        // Verify user
        if (session.userId !== userId) {
            throw new AppError('Access denied', 403);
        }

        // Verify all chunks received
        if (session.receivedChunks.length !== session.totalChunks) {
            throw new AppError(`Missing chunks. Received ${session.receivedChunks.length}/${session.totalChunks}`, 400);
        }

        console.log(`[ChunkedUpload] Assembling ${session.totalChunks} chunks for ${session.uploadId}`);

        // Assemble chunks into final file
        const finalPath = path.join(session.tempDir, 'assembled');
        const writeStream = fs.createWriteStream(finalPath);

        for (let i = 0; i < session.totalChunks; i++) {
            const chunkPath = path.join(session.tempDir, `chunk-${i.toString().padStart(5, '0')}`);
            const chunkData = await fs.promises.readFile(chunkPath);
            writeStream.write(chunkData);
        }

        await new Promise<void>((resolve, reject) => {
            writeStream.end((err: Error | null) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Read assembled file for upload
        const fileBuffer = await fs.promises.readFile(finalPath);
        const fileId = uuidv4();

        const requiresNormalization = session.mimeType !== 'application/pdf';
        const effectiveSecure = session.isSecure || requiresNormalization;

        if (requiresNormalization && !session.isSecure) {
            console.warn(`[ChunkedUpload] Forcing secure conversion for non-PDF file: ${session.filename} (${session.mimeType})`);
        }

        // Determine storage path based on effective security mode
        let storageKey: string;

        if (effectiveSecure) {
            // Create a pending PartFile record
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const partFile = await prisma.partFile.create({
                data: {
                    id: fileId,
                    partId: session.partId,
                    title: session.filename,
                    displayName: session.filename,
                    type: 'PDF',
                    storageKey: '', // Will be updated by worker
                    renderStatus: 'PROCESSING',
                    order: await this.getNextOrder(session.partId),
                    isSecure: true
                }
            });

            // Upload source file to shared staging storage for worker processing
            const ext = this.getExtension(session.mimeType);
            const sourceKey = `/staging/pdf-input/${fileId}/source${ext}`;
            const sourceFile: Express.Multer.File = {
                buffer: fileBuffer,
                mimetype: session.mimeType,
                originalname: session.filename,
                fieldname: 'file',
                encoding: '7bit',
                size: fileBuffer.length,
                destination: '',
                filename: '',
                path: '',
                stream: null as any
            };
            await storage.uploadPrivate(sourceFile, sourceKey);

            // Queue for processing
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { pdfQueue } = require('../../queues/pdf.queue');
            const job = await pdfQueue.add('watermark-pdf', {
                sourceKey,
                sourceMime: session.mimeType,
                originalName: session.filename,
                partFileId: fileId,
                adminName: WATERMARK_QUEUE_LABEL
            });
            console.log(`[ChunkedUpload] Queued secure file ${fileId} for processing. jobId=${job.id} sourceKey=${sourceKey}`);

            storageKey = ''; // Will be set by worker

        } else {
            // Direct upload for downloadable files
            storageKey = `/public/${session.partId}/${fileId}/${session.filename}`;
            
            // Create a mock file object for the storage provider
            const mockFile: Express.Multer.File = {
                buffer: fileBuffer,
                mimetype: session.mimeType,
                originalname: session.filename,
                fieldname: 'file',
                encoding: '7bit',
                size: fileBuffer.length,
                destination: '',
                filename: '',
                path: '',
                stream: null as any
            };

            await storage.uploadPublic(mockFile, storageKey);

            await prisma.partFile.create({
                data: {
                    id: fileId,
                    partId: session.partId,
                    title: session.filename,
                    type: 'PDF',
                    storageKey,
                    order: await this.getNextOrder(session.partId),
                    isSecure: false,
                    renderStatus: 'COMPLETED'
                }
            });

            console.log(`[ChunkedUpload] Uploaded downloadable file ${fileId} to ${storageKey}`);
        }

        // Cleanup session
        // Remove from Redis and delete temp dir
        await redis.del(key);
        try {
            await fs.promises.rm(session.tempDir, { recursive: true, force: true });
        } catch (e) {
            console.error(`[ChunkedUpload] Failed to cleanup temp dir: ${session.tempDir}`);
        }

        return {
            storageKey,
            assetId: fileId
        };
    }

    private async getNextOrder(partId: string): Promise<number> {
        const lastFile = await prisma.partFile.findFirst({
            where: { partId },
            orderBy: { order: 'desc' }
        });
        return (lastFile?.order || 0) + 1;
    }

    private getExtension(mimetype: string): string {
        switch (mimetype) {
            case 'application/pdf': return '.pdf';
            case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': return '.pptx';
            case 'application/vnd.ms-powerpoint': return '.ppt';
            case 'application/msword': return '.doc';
            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return '.docx';
            case 'text/plain': return '.txt';
            default: return '.bin';
        }
    }
}
