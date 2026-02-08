import { Request, Response, NextFunction } from 'express';
import { BunnyStreamService } from '../../services/video/bunny-stream.service';
import prisma from '../../config/prisma';
import { AppError } from '../../utils/app-error';

/**
 * BUNNY STREAM WEBHOOK TYPES
 * 
 * Bunny Stream sends webhooks for video lifecycle events.
 * These TypeScript interfaces match Bunny's webhook payload structure.
 */

export interface BunnyWebhookPayload {
    VideoLibraryId: number;
    VideoGuid: string;
    Status: number; // 4 = Finished, 5 = Error
    DateUploaded: string;
    DateEncoded: string;
    Title: string;
    Length: number; // Duration in seconds
    ThumbnailFileName: string | null;
    AvailableResolutions: string | null;
    Width: number;
    Height: number;
    // For webhook events
    Event?: string;
}

export interface BunnyWebhookEvent {
    VideoLibraryId: string;
    VideoGuid: string;
    Event: 'video.encoded' | 'video.transcoded' | 'video.error' | 'video.created' | 'video.uploaded';
    Data?: BunnyWebhookPayload;
}

// Internal tracking of pending video uploads
interface PendingVideoUpload {
    videoId: string;
    partLessonId?: string;
    createdAt: Date;
}

// Simple in-memory store for pending uploads
// In production, this should be in Redis or DB
const pendingUploads = new Map<string, PendingVideoUpload>();

export class BunnyWebhookController {
    /**
     * Register a pending upload for webhook matching
     * Called when admin initiates a video upload
     */
    static registerPendingUpload(videoId: string, partLessonId?: string): void {
        pendingUploads.set(videoId, {
            videoId,
            partLessonId,
            createdAt: new Date()
        });

        // Cleanup old entries after 24 hours
        setTimeout(() => {
            pendingUploads.delete(videoId);
        }, 24 * 60 * 60 * 1000);
    }

    /**
     * POST /api/v1/webhooks/bunny
     * 
     * Receives Bunny Stream webhook events.
     * Verifies signature and updates database accordingly.
     */
    async handleWebhook(req: Request, res: Response, next: NextFunction) {
        try {
            // Get raw body for signature verification
            const rawBody = JSON.stringify(req.body);
            const signature = req.headers['webhook-signature'] as string;

            // SECURITY: Verify webhook signature
            if (signature && !BunnyStreamService.verifyWebhookSignature(rawBody, signature)) {
                console.warn('[BunnyWebhook] Invalid signature received');
                return res.status(401).json({ success: false, message: 'Invalid signature' });
            }

            const payload = req.body as BunnyWebhookPayload | BunnyWebhookEvent;
            
            console.log('[BunnyWebhook] Received:', JSON.stringify(payload, null, 2));

            // Handle both event wrapper and direct payload formats
            // Both types have VideoGuid, so we access it directly
            const videoId = payload.VideoGuid;
            const status = 'Status' in payload ? payload.Status : (payload.Data?.Status || 0);
            const event = payload.Event || null;

            if (!videoId) {
                console.warn('[BunnyWebhook] No VideoGuid in payload');
                return res.status(400).json({ success: false, message: 'Missing VideoGuid' });
            }

            // Handle video encoding completed
            if (status === 4 || event === 'video.encoded' || event === 'video.transcoded') {
                await this.handleVideoReady(videoId, payload as BunnyWebhookPayload);
            }

            // Handle video encoding failed
            if (status === 5 || event === 'video.error') {
                await this.handleVideoError(videoId);
            }

            // Acknowledge receipt immediately
            return res.status(200).json({ success: true, message: 'Webhook processed' });

        } catch (error) {
            console.error('[BunnyWebhook] Error:', error);
            // Still return 200 to prevent Bunny from retrying indefinitely
            return res.status(200).json({ success: true, message: 'Webhook received with errors' });
        }
    }

    /**
     * Handle video successfully encoded
     */
    private async handleVideoReady(videoId: string, payload: BunnyWebhookPayload): Promise<void> {
        console.log(`[BunnyWebhook] Video ${videoId} is ready`);

        // Check if this video is registered as pending
        const pending = pendingUploads.get(videoId);

        // Find any PartLesson with this video ID
        const partLesson = await prisma.partLesson.findFirst({
            where: { video: videoId }
        });

        if (partLesson) {
            // Video is already linked to a lesson - just log success
            console.log(`[BunnyWebhook] Video ${videoId} linked to PartLesson ${partLesson.id}`);
        } else if (pending?.partLessonId) {
            // Update the pending lesson with video info
            await prisma.partLesson.update({
                where: { id: pending.partLessonId },
                data: { video: videoId }
            });
            console.log(`[BunnyWebhook] Linked video ${videoId} to PartLesson ${pending.partLessonId}`);
        }

        // Log the encoding completion
        console.log(`[BunnyWebhook] Video ready: ${videoId}, Duration: ${payload.Length}s, Resolutions: ${payload.AvailableResolutions}`);

        // Cleanup pending entry
        pendingUploads.delete(videoId);
    }

    /**
     * Handle video encoding error
     */
    private async handleVideoError(videoId: string): Promise<void> {
        console.error(`[BunnyWebhook] Video ${videoId} encoding failed`);

        // Find linked lesson and potentially mark as failed
        const partLesson = await prisma.partLesson.findFirst({
            where: { video: videoId }
        });

        if (partLesson) {
            console.error(`[BunnyWebhook] Video error for PartLesson ${partLesson.id}`);
            // Could add a status field to PartLesson to track failed videos
        }

        // Cleanup pending entry
        pendingUploads.delete(videoId);
    }
}
