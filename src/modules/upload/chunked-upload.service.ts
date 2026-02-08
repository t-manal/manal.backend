import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import prisma from '../../config/prisma';
import { BunnyStorageProvider } from '../../services/storage/bunny-storage.provider';
import { AppError } from '../../utils/app-error';
import { UPLOAD_LIMITS } from '../../config/upload-limits.config';

const storage = new BunnyStorageProvider();

// In-memory store for active chunked uploads
// In production with multiple instances, use Redis
interface ChunkedUploadSession {
    uploadId: string;
    filename: string;
    fileSize: number;
    mimeType: string;
    totalChunks: number;
    receivedChunks: Set<number>;
    partId: string;
    isSecure: boolean;
    tempDir: string;
    createdAt: Date;
    userId: string;
}

const uploadSessions = new Map<string, ChunkedUploadSession>();

// Cleanup stale sessions older than 1 hour
const UPLOAD_SESSION_TTL = 60 * 60 * 1000; // 1 hour

setInterval(() => {
    const now = Date.now();
    for (const [uploadId, session] of uploadSessions) {
        if (now - session.createdAt.getTime() > UPLOAD_SESSION_TTL) {
            console.log(`[ChunkedUpload] Cleaning up stale session: ${uploadId}`);
            cleanupSession(uploadId);
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

async function cleanupSession(uploadId: string) {
    const session = uploadSessions.get(uploadId);
    if (session) {
        try {
            await fs.promises.rm(session.tempDir, { recursive: true, force: true });
        } catch (e) {
            console.error(`[ChunkedUpload] Failed to cleanup temp dir: ${session.tempDir}`);
        }
        uploadSessions.delete(uploadId);
    }
}

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
        const isAdmin = user?.role === 'ADMIN' as any;
        const isOwner = part.lecture.course.instructorId === userId;

        if (!isAdmin && !isOwner) {
            throw new AppError('Access denied', 403);
        }

        // Create unique upload ID and temp directory
        const uploadId = uuidv4();
        const tempDir = path.join(os.tmpdir(), `lms-chunked-${uploadId}`);
        await fs.promises.mkdir(tempDir, { recursive: true });

        // Store session
        const session: ChunkedUploadSession = {
            uploadId,
            filename: input.filename,
            fileSize: input.fileSize,
            mimeType: input.mimeType,
            totalChunks: input.totalChunks,
            receivedChunks: new Set(),
            partId: input.partId,
            isSecure: input.isSecure,
            tempDir,
            createdAt: new Date(),
            userId
        };

        uploadSessions.set(uploadId, session);
        console.log(`[ChunkedUpload] Initialized session ${uploadId} for ${input.filename} (${input.totalChunks} chunks)`);

        return { uploadId };
    }

    /**
     * Upload a single chunk
     */
    async uploadChunk(input: ChunkUploadInput): Promise<{ received: number; total: number }> {
        const session = uploadSessions.get(input.uploadId);
        if (!session) {
            throw new AppError('Upload session not found or expired', 404);
        }

        // Validate chunk index
        if (input.chunkIndex < 0 || input.chunkIndex >= session.totalChunks) {
            throw new AppError('Invalid chunk index', 400);
        }

        // Validate chunk size (last chunk may be smaller)
        const isLastChunk = input.chunkIndex === session.totalChunks - 1;
        const expectedChunkSize = isLastChunk 
            ? session.fileSize % UPLOAD_LIMITS.CHUNK || UPLOAD_LIMITS.CHUNK
            : UPLOAD_LIMITS.CHUNK;

        if (input.chunk.length > UPLOAD_LIMITS.CHUNK) {
            throw new AppError('Chunk too large', 400);
        }

        // Write chunk to temp file
        const chunkPath = path.join(session.tempDir, `chunk-${input.chunkIndex.toString().padStart(5, '0')}`);
        await fs.promises.writeFile(chunkPath, input.chunk);

        // Mark chunk as received
        session.receivedChunks.add(input.chunkIndex);

        console.log(`[ChunkedUpload] Received chunk ${input.chunkIndex + 1}/${session.totalChunks} for ${session.uploadId}`);

        return {
            received: session.receivedChunks.size,
            total: session.totalChunks
        };
    }

    /**
     * Finalize and assemble all chunks
     */
    async finalizeUpload(userId: string, input: FinalizeUploadInput): Promise<{ storageKey: string; assetId: string }> {
        const session = uploadSessions.get(input.uploadId);
        if (!session) {
            throw new AppError('Upload session not found or expired', 404);
        }

        // Verify user
        if (session.userId !== userId) {
            throw new AppError('Access denied', 403);
        }

        // Verify all chunks received
        if (session.receivedChunks.size !== session.totalChunks) {
            throw new AppError(`Missing chunks. Received ${session.receivedChunks.size}/${session.totalChunks}`, 400);
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

        // Determine storage path based on security mode
        let storageKey: string;

        if (session.isSecure) {
            // Create a pending PartFile record that will be processed by PDF worker
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

            // Write to temp for worker to process
            const ext = this.getExtension(session.mimeType);
            const workerInputPath = path.join(os.tmpdir(), `lms-upload-${fileId}-input${ext}`);
            await fs.promises.writeFile(workerInputPath, fileBuffer);

            // Queue for processing
            const { pdfQueue } = require('../../queues/pdf.queue');
            await pdfQueue.add('watermark-pdf', {
                filePath: workerInputPath,
                partFileId: fileId,
                adminName: 'Dr. Manal'
            });

            storageKey = ''; // Will be set by worker
            console.log(`[ChunkedUpload] Queued secure file ${fileId} for processing`);

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
        await cleanupSession(input.uploadId);

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
            default: return '.bin';
        }
    }
}
