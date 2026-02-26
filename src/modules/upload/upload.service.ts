import prisma from '../../config/prisma';
import { BunnyStorageProvider } from '../../services/storage/bunny-storage.provider';
import { BunnyStreamService } from '../../services/video/bunny-stream.service';
import { AppError } from '../../utils/app-error';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';


const storage = new BunnyStorageProvider();
const streamService = new BunnyStreamService();

export class UploadService {
    // SECURITY FIX: Centralized Lock Checking (Fix #1)
    private async checkPartAccessWithLocks(
        userId: string, 
        partId: string, 
        enrollmentId?: string
    ): Promise<void> {
        // Check if user has an explicit lock on this part
        if (enrollmentId) {
            const lock = await prisma.enrollmentPartLock.findUnique({
                where: {
                    enrollmentId_partId: { enrollmentId, partId }
                }
            });
            
            if (lock && lock.isLocked) {
                throw new AppError('This content is currently locked by the administrator.', 403);
            }
        }
    }

    private getExtension(mimetype: string): string {
        switch (mimetype) {
            case 'image/jpeg':
            case 'image/jpg': return '.jpg';
            case 'image/png': return '.png';
            case 'image/webp': return '.webp';
            case 'application/pdf': return '.pdf';
            case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': return '.pptx';
            case 'application/vnd.ms-powerpoint': return '.ppt';
            case 'application/msword': return '.doc';
            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return '.docx';
            case 'text/plain': return '.txt';
            default: throw new AppError('Unsupported file type', 400);
        }
    }

    private validateMime(mimetype: string, allowed: string[]) {
        if (!allowed.includes(mimetype)) {
            console.log(`[UploadService] Rejected mime type: ${mimetype}. Allowed: ${allowed.join(', ')}`);
            throw new AppError('Invalid file type', 400);
        }
    }

    private validateConfig() {
        if (!process.env.BUNNY_STORAGE_API_KEY || !process.env.BUNNY_STORAGE_ZONE) {
            console.error('[UploadService] Missing Bunny Configuration');
            throw new AppError('Storage not configured (Missing ENV)', 503);
        }
    }

    async uploadThumbnail(userId: string, courseId: string, file: Express.Multer.File) {
        this.validateConfig();
        this.validateMime(file.mimetype, ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) throw new AppError('Course not found', 404);
        if (course.instructorId !== userId) throw new AppError('Access denied', 403);

        const ext = this.getExtension(file.mimetype);
        const key = `/courses/${courseId}/thumbnail/${uuidv4()}${ext}`;

        console.log(`[UploadService] Uploading thumbnail for course ${courseId} to key: ${key}`);
        const result = await storage.uploadPublic(file, key);
        console.log(`[UploadService] Generated public URL: ${result.url}`);

        const updatedCourse = await prisma.course.update({
            where: { id: courseId },
            data: { thumbnail: result.url },
        });

        console.log(`[UploadService] Database updated for course ${courseId}. New thumbnail: ${updatedCourse.thumbnail}`);
        return updatedCourse;
    }

    async uploadAvatar(userId: string, file: Express.Multer.File) {
        this.validateConfig();
        this.validateMime(file.mimetype, ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

        const ext = this.getExtension(file.mimetype);
        const key = `/users/${userId}/avatar/${uuidv4()}${ext}`;

        const result = await storage.uploadPublic(file, key);

        await prisma.user.update({
            where: { id: userId },
            data: { avatar: result.url }
        });

        return { url: result.url };
    }

    async uploadLessonPdf(userId: string, lessonId: string, file: Express.Multer.File, title?: string, isSecureStr?: string | boolean) {
        this.validateConfig();
        
        // PHASE 10-C: Universal Doc Support (Allowed extensions handled by Route/Multer)
        const allowedMimes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.ms-powerpoint',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];
        
        if (!allowedMimes.includes(file.mimetype)) {
            throw new AppError('Unsupported file type. Allowed: PDF, PPTX, DOCX, TXT', 400);
        }

        // PHASE 10-C: Default to TRUE for security/conversion if not specified
        const requestedSecure = isSecureStr === undefined ? true : String(isSecureStr) === 'true';
        const requiresNormalization = file.mimetype !== 'application/pdf';
        const isSecure = requestedSecure || requiresNormalization;

        if (requiresNormalization && !requestedSecure) {
            console.warn(`[UploadService] Forcing secure conversion for non-PDF file: ${file.originalname} (${file.mimetype})`);
        }

        // Polymorphic check: Part (New) or Lesson (Old)
        const part = await prisma.part.findUnique({
            where: { id: lessonId },
            include: { lecture: { include: { course: true } } }
        });

        if (part) {
            if (part.lecture.course.instructorId !== userId) throw new AppError('Access denied', 403);
            
            const lastFile = await prisma.partFile.findFirst({
                where: { partId: lessonId },
                orderBy: { order: 'desc' }
            });
            const order = (lastFile?.order || 0) + 1;
            const fileId = uuidv4();

            // 1. SECURE PATH (Watermarking + Encrypted View)
            if (isSecure) {
                console.log(`[UploadService] Secure Upload for ${file.originalname}. Queueing job...`);

                const ext = this.getExtension(file.mimetype);
                const sourceKey = `/staging/pdf-input/${fileId}/source${ext}`;
                await storage.uploadPrivate(file, sourceKey);
                console.log(`[UploadService] Staged secure source file. partFileId=${fileId} sourceKey=${sourceKey}`);

                // Phase 10-IMPROVEMENT: Custom Display Name
                const originalNameBase = path.parse(file.originalname).name;
                const displayName = `${originalNameBase}.pdf`;

                // Create DB Record (PENDING)
                await prisma.partFile.create({
                    data: {
                        id: fileId,
                        partId: lessonId,
                        title: title || file.originalname,
                        displayName: displayName, // Persist custom display name
                        type: 'PDF',
                        storageKey: '', // Will be updated by Worker
                        renderStatus: 'PROCESSING', // Worker handles conversion
                        order: await this.getNextOrder(lessonId),
                        isSecure: isSecure
                    }
                });

                // Add to Queue
                const { pdfQueue } = require('../../queues/pdf.queue'); // Deferred require to avoid circular deps if any
                const job = await pdfQueue.add('watermark-pdf', {
                    sourceKey,
                    sourceMime: file.mimetype,
                    originalName: file.originalname,
                    partFileId: fileId,
                    adminName: 'Dr. Manal' // Hardcoded Contract #9
                });
                console.log(`[UploadService] Queued secure PDF job. partFileId=${fileId} jobId=${job.id} sourceKey=${sourceKey}`);

                return { status: 'QUEUED', id: fileId };
            } 
            
            // 2. DOWNLOADABLE PATH (Direct Passthrough)
            else {
                console.log(`[UploadService] Direct Upload for ${file.originalname} (Downloadable).`);
                
                const key = `/public/${lessonId}/${fileId}/${file.originalname}`; // Public path
                await storage.uploadPublic(file, key);

                // Create DB Record (COMPLETED)
                const record = await prisma.partFile.create({
                    data: {
                        id: fileId,
                        partId: lessonId,
                        title: title || file.originalname,
                        type: 'PDF',
                        storageKey: key, // Direct link
                        order,
                        isSecure: false,
                        renderStatus: 'COMPLETED'
                    }
                });
                return record;
            }
        }

        throw new AppError('Part not found', 404);
    }

    // STRICT PHASE 10: Replaced getPdfStream with getRenderedPage
    async getRenderedPage(userId: string, partFileId: string, pageNumber: number) {
        // 1. Lookup PartFile
        const partFile = await prisma.partFile.findUnique({
            where: { id: partFileId },
            include: { part: { include: { lecture: { include: { course: true } } } } }
        });

        if (!partFile) throw new AppError('Document not found', 404);
        
        // 2. Validate Access
        const course = partFile.part.lecture.course;
        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId: course.id } }
        });

        const isInstructor = course.instructorId === userId;
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const isAdmin = user?.role === 'ADMIN' as any;
        
        const hasAccess = isInstructor || isAdmin || course.isFree || (enrollment && enrollment.status === 'ACTIVE');
        
        if (!hasAccess) throw new AppError('Access denied', 403);
        
        // SECURITY FIX: Apply centralized lock check (Fix #1)
        if (enrollment && !isInstructor && !isAdmin) {
            await this.checkPartAccessWithLocks(userId, partFile.partId, enrollment.id);
        }

        // 3. Resolve Page Key
        if (pageNumber < 1 || pageNumber > partFile.pageCount) {
             throw new AppError('Page not found', 404);
        }

        const pageKey = `${partFile.storageKey}/page-${pageNumber}.png`;
        
        // 4. Return Stream (Proxy)
        return {
            stream: await storage.downloadStream(pageKey),
            contentType: 'image/png',
            filename: `page-${pageNumber}.png`
        };
    }

    // STRICT PHASE 10: Metadata Access for Viewer
    async getDocumentMetadata(userId: string, assetId: string) {
        // 1. Lookup PartFile by ID (Specific Asset)
        const partFile = await prisma.partFile.findUnique({
            where: { id: assetId },
            include: { part: { include: { lecture: { include: { course: true } } } } }
        });

        if (!partFile) throw new AppError('Document not found', 404);
        
        // 2. Validate Access
        const course = partFile.part.lecture.course;
        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId: course.id } }
        });

        const isInstructor = course.instructorId === userId;
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const isAdmin = user?.role === 'ADMIN' as any;
        
        const hasAccess = isInstructor || isAdmin || course.isFree || (enrollment && enrollment.status === 'ACTIVE');
        
        if (!hasAccess) throw new AppError('Access denied', 403);

        return {
            title: partFile.title,
            displayName: partFile.displayName || partFile.title, // Phase 10-IMPROVEMENT
            pageCount: partFile.pageCount,
            renderStatus: partFile.renderStatus,
            isSecure: partFile.isSecure,
            id: partFile.id // Echo ID
        };
    }

    // ... (initVideoUpload and uploadFile remain unchanged)

    async initVideoUpload(title: string) {
        return streamService.createVideo(title);
    }

    async uploadFile(userId: string, file: Express.Multer.File) {
        this.validateMime(file.mimetype, ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
        const ext = this.getExtension(file.mimetype);
        const key = `/uploads/${userId}/${uuidv4()}${ext}`;
        const result = await storage.uploadPublic(file, key);
        return { url: result.url };
    }

    // PHASE 10-B: Secure Streaming Endpoint
    async getSecurePdf(userId: string, assetId: string) {
        // 1. Lookup PartFile by ID (Specific Asset)
        const partFile = await prisma.partFile.findUnique({
            where: { id: assetId },
            include: { part: { include: { lecture: { include: { course: true } } } } }
        });

        if (!partFile) throw new AppError('Document not found', 404);
        
        // 2. Validate Access
        const course = partFile.part.lecture.course;
        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId: course.id } }
        });

        const isInstructor = course.instructorId === userId;
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const isAdmin = user?.role === 'ADMIN' as any;
        
        const hasAccess = isInstructor || isAdmin || course.isFree || (enrollment && enrollment.status === 'ACTIVE');
        if (!hasAccess) throw new AppError('Access denied', 403);
        
        // SECURITY FIX: Apply centralized lock check (Fix #1)
        if (enrollment && !isInstructor && !isAdmin) {
            await this.checkPartAccessWithLocks(userId, partFile.partId, enrollment.id);
        }

        // 3. Determine Source
        let key = partFile.storageKey;
        
        if (partFile.renderStatus !== 'COMPLETED') {
             throw new AppError('Document is processing', 423); 
        }

        // 4. Return Stream
        try {
            const stream = await storage.downloadStream(key);
            // Phase 10-IMPROVEMENT: Use displayName if available
            const downloadName = partFile.displayName || `${partFile.title}.pdf`;
            
            return {
                stream,
                contentType: 'application/pdf',
                filename: downloadName
            };
        } catch (e) {
             throw new AppError('File not found in storage', 404);
        }
    }

    private async getNextOrder(lessonId: string): Promise<number> {
        const lastFile = await prisma.partFile.findFirst({
            where: { partId: lessonId },
            orderBy: { order: 'desc' }
        });
        return (lastFile?.order || 0) + 1;
    }
}
