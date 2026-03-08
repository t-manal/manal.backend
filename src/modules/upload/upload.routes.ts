import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { UploadController } from './upload.controller';
import { ChunkedUploadController } from './chunked-upload.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requirePanelRole, requireAnyRole } from '../../middlewares/rbac.middleware';
import { Role } from '@prisma/client';
import { validate } from './validate.middleware';
import { uploadThumbnailSchema, uploadAvatarSchema, uploadPdfSchema } from './upload.schema';
import { AppError } from '../../utils/app-error';
import { UPLOAD_LIMITS } from '../../config/upload-limits.config';
import { assetFramingGuard } from '../../middlewares/asset-security.middleware';

const router = Router();
const controller = new UploadController();
const chunkedController = new ChunkedUploadController();

const fileFilter = (allowedMimes: string[]) => (req: any, file: Express.Multer.File, cb: any) => {
    let effectiveMime = file.mimetype;

    if (!effectiveMime || effectiveMime === 'application/octet-stream') {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg') effectiveMime = 'image/jpeg';
        else if (ext === '.png') effectiveMime = 'image/png';
        else if (ext === '.webp') effectiveMime = 'image/webp';
        else if (ext === '.pdf') effectiveMime = 'application/pdf';
        else if (ext === '.pptx') effectiveMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        else if (ext === '.ppt') effectiveMime = 'application/vnd.ms-powerpoint';
        else if (ext === '.docx') effectiveMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (ext === '.doc') effectiveMime = 'application/msword';
        else if (ext === '.txt') effectiveMime = 'text/plain';
    }

    file.mimetype = effectiveMime;

    if (allowedMimes.includes(effectiveMime)) {
        cb(null, true);
    } else {
        cb(new AppError('Invalid file type: ' + (effectiveMime || 'empty') + ' (' + file.originalname + ')', 400), false);
    }
};

const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_LIMITS.IMAGE }, // POLICY: 5MB centralized
    fileFilter: fileFilter(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
});

const uploadPdf = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_LIMITS.PDF }, // POLICY: 100MB centralized
    fileFilter: fileFilter([
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'application/pdf', 
        'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
        'application/vnd.ms-powerpoint', // ppt
        'application/msword', // doc
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
        'text/plain', // txt
        'text/x-c', // c
        'text/x-c++', // cpp
        'text/x-java-source', // java
        'application/javascript', // js
        'text/x-python', // py
        'text/html', // html
        'application/octet-stream' // fallback for code files
    ])
});

// Chunk upload (accepts any binary data up to CHUNK limit)
const uploadChunk = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_LIMITS.CHUNK + 1024 }, // 5MB + small buffer for overhead
});


// ============================================================================
// BUNNY STREAM DIRECT UPLOAD (Zero-Proxy Video Upload)
// ============================================================================

/**
 * GET /uploads/bunny/prepare
 * Returns credentials for direct video upload to Bunny Stream CDN
 * The video file goes directly from browser to Bunny - never touches Railway
 * Requires: ADMIN role
 */
router.get('/uploads/bunny/prepare',
    authMiddleware,
    requirePanelRole,
    controller.prepareBunnyUpload
);

// ============================================================================
// CHUNKED UPLOAD ENDPOINTS (New - Performance & Scale)
// ============================================================================

/**
 * POST /uploads/init
 * Initialize a chunked upload session
 * Requires: ADMIN role
 */
router.post('/uploads/init',
    authMiddleware,
    requirePanelRole,
    chunkedController.initUpload
);

/**
 * POST /uploads/chunk
 * Upload a single chunk
 * Requires: ADMIN role
 */
router.post('/uploads/chunk',
    authMiddleware,
    requirePanelRole,
    uploadChunk.single('chunk'),
    chunkedController.uploadChunk
);

/**
 * POST /uploads/finalize
 * Assemble all chunks and complete the upload
 * Requires: ADMIN role
 */
router.post('/uploads/finalize',
    authMiddleware,
    requirePanelRole,
    chunkedController.finalizeUpload
);

// ============================================================================
// EXISTING UPLOAD ENDPOINTS
// ============================================================================

// Thumbnails
router.post('/courses/:courseId/thumbnail',
    authMiddleware,
    requirePanelRole,
    validate(uploadThumbnailSchema),
    uploadImage.single('file'),
    controller.uploadThumbnail
);

// Avatar
router.post('/users/me/avatar',
    authMiddleware,
    validate(uploadAvatarSchema),
    uploadImage.single('file'),
    controller.uploadAvatar
);

// Image + Document Upload for Lessons
router.post('/instructor/lessons/:lessonId/files',
    authMiddleware,
    requirePanelRole,
    uploadPdf.single('file'),
    controller.uploadLessonImage
);

// Document Rendering Ingest (Phase 10)
router.post('/lessons/:lessonId/document',
    authMiddleware,
    requirePanelRole,
    validate(uploadPdfSchema),
    uploadPdf.single('file'),
    controller.uploadPdf
);

// Rate Limiter Import
import { publicRateLimiter } from '../../middlewares/rate-limit.middleware';

// Rendered Page Access (Phase 10)
router.get('/lessons/:lessonId/pages/:pageNumber',
    authMiddleware,
    requireAnyRole,
    publicRateLimiter,
    // assetFramingGuard removed: Pages are images, no need for frame-ancestors. 
    // The viewer is an img tag, not an iframe.
    controller.renderPage
);

// Metadata (Phase 10 Viewer)
router.get('/lessons/assets/:assetId/document/metadata',
    authMiddleware,
    requireAnyRole,
    controller.getMetadata
);

// Secure PDF Stream (Phase 10-B)
router.get('/lessons/assets/:assetId/document/stream',
    authMiddleware,
    requireAnyRole,
    // publicRateLimiter, // Optional: might need stricter limiting? Standard is fine.
    controller.securePdf
);

// Video Upload Init
router.post('/video/init',
    authMiddleware,
    requirePanelRole,
    controller.initVideoUpload
);

// Generic Upload
router.post('/upload',
    authMiddleware,
    uploadImage.single('file'),
    controller.uploadFile
);

export default router;
