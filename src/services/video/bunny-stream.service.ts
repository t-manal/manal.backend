import axios from 'axios';
import crypto from 'crypto';
import { AppError } from '../../utils/app-error';

/**
 * BUNNY STREAM SERVICE
 * 
 * Handles all interactions with Bunny Stream API:
 * - Video creation and upload credential generation
 * - Secure playback signature generation
 * - Video status checking
 * 
 * SECURITY: Videos are uploaded directly from browser to Bunny CDN.
 * The backend never touches video binary data.
 */

export interface VideoUploadCredentials {
    videoId: string;
    authorizationSignature: string;
    expirationTime: number;
    libraryId: string;
    uploadUrl: string;
    tusEndpoint: string;
}

export interface VideoStatus {
    videoId: string;
    status: number; // 0=created, 1=uploaded, 2=processing, 3=transcoding, 4=finished, 5=error
    statusText: string;
    title: string;
    thumbnailUrl: string | null;
    length: number; // Duration in seconds
    availableResolutions: string | null;
}

export class BunnyStreamService {
    private apiKey: string;
    private libraryId: string;
    private cdnHostname: string;
    private baseUrl = 'https://video.bunnycdn.com/library';

    constructor() {
        this.apiKey = process.env.BUNNY_STREAM_API_KEY || '';
        this.libraryId = process.env.BUNNY_STREAM_LIBRARY_ID || '';
        this.cdnHostname = process.env.BUNNY_STREAM_CDN_HOSTNAME || '';

        if (!this.apiKey || !this.libraryId) {
            console.warn('[BunnyStreamService] Missing BUNNY_STREAM_API_KEY or BUNNY_STREAM_LIBRARY_ID');
        }
    }

    /**
     * Validate that the service is properly configured
     */
    private validateConfig(): void {
        if (!this.apiKey || !this.libraryId) {
            throw new AppError('Bunny Stream is not properly configured. Missing API credentials.', 500);
        }
    }

    /**
     * Create a new video entry in Bunny Stream and return upload credentials
     * The frontend uses these credentials to upload directly to Bunny
     */
    async createVideo(title: string): Promise<VideoUploadCredentials> {
        this.validateConfig();

        try {
            // Step 1: Create video entry in Bunny
            const response = await axios.post(
                `${this.baseUrl}/${this.libraryId}/videos`,
                { title },
                { headers: { AccessKey: this.apiKey } }
            );

            const videoId = response.data.guid;

            // Step 2: Generate presigned upload signature
            // Signature = sha256(libraryId + apiKey + expiration + videoId)
            const expirationTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour
            const signatureString = this.libraryId + this.apiKey + expirationTime + videoId;
            const authorizationSignature = crypto
                .createHash('sha256')
                .update(signatureString)
                .digest('hex');

            return {
                videoId,
                authorizationSignature,
                expirationTime,
                libraryId: this.libraryId,
                // Direct upload URL for simple PUT request
                uploadUrl: `https://video.bunnycdn.com/library/${this.libraryId}/videos/${videoId}`,
                // TUS endpoint for resumable uploads (recommended for large files)
                tusEndpoint: `https://video.bunnycdn.com/tusupload`,
            };
        } catch (error: any) {
            console.error('[BunnyStreamService] Create Video Error:', error.response?.data || error.message);
            throw new AppError('Failed to initialize video upload with Bunny Stream', 502);
        }
    }

    /**
     * Generate a secure playback signature for video embedding
     * This prevents unauthorized users from embedding or downloading videos
     * 
     * Signature = SHA256(token_security_key + videoId + expirationTime)
     */
    generatePlaybackSignature(videoId: string, expirationTime?: number): { 
        signature: string; 
        expires: number;
        embedUrl: string;
    } {
        this.validateConfig();

        const tokenKey = process.env.BUNNY_STREAM_TOKEN_KEY || this.apiKey;
        const expires = expirationTime || Math.floor(Date.now() / 1000) + 7200; // 2 hours

        // Bunny's token authentication format
        const signatureBase = tokenKey + videoId + expires;
        const signature = crypto
            .createHash('sha256')
            .update(signatureBase)
            .digest('hex');

        // Build secure embed URL
        const cdnHost = this.cdnHostname || `${this.libraryId}.b-cdn.net`;
        const embedUrl = `https://iframe.mediadelivery.net/embed/${this.libraryId}/${videoId}?token=${signature}&expires=${expires}`;

        return {
            signature,
            expires,
            embedUrl
        };
    }

    /**
     * Get the current processing status of a video
     */
    async getVideoStatus(videoId: string): Promise<VideoStatus> {
        this.validateConfig();

        try {
            const response = await axios.get(
                `${this.baseUrl}/${this.libraryId}/videos/${videoId}`,
                { headers: { AccessKey: this.apiKey } }
            );

            const data = response.data;
            
            const statusMap: Record<number, string> = {
                0: 'CREATED',
                1: 'UPLOADED',
                2: 'PROCESSING',
                3: 'TRANSCODING',
                4: 'FINISHED',
                5: 'ERROR',
                6: 'UPLOAD_FAILED'
            };

            return {
                videoId: data.guid,
                status: data.status,
                statusText: statusMap[data.status] || 'UNKNOWN',
                title: data.title,
                thumbnailUrl: data.thumbnailFileName 
                    ? `https://${this.cdnHostname || this.libraryId + '.b-cdn.net'}/${videoId}/${data.thumbnailFileName}`
                    : null,
                length: data.length || 0,
                availableResolutions: data.availableResolutions
            };
        } catch (error: any) {
            console.error('[BunnyStreamService] Get Video Status Error:', error.response?.data || error.message);
            throw new AppError('Failed to fetch video status from Bunny Stream', 502);
        }
    }

    /**
     * Delete a video from Bunny Stream
     */
    async deleteVideo(videoId: string): Promise<void> {
        this.validateConfig();

        try {
            await axios.delete(
                `${this.baseUrl}/${this.libraryId}/videos/${videoId}`,
                { headers: { AccessKey: this.apiKey } }
            );
        } catch (error: any) {
            console.error('[BunnyStreamService] Delete Video Error:', error.response?.data || error.message);
            throw new AppError('Failed to delete video from Bunny Stream', 502);
        }
    }

    /**
     * Verify Bunny webhook signature
     * 
     * Bunny sends signature in header: Webhook-Signature
     * Signature = SHA256(webhookSecret + request body)
     */
    static verifyWebhookSignature(payload: string, signature: string): boolean {
        const webhookSecret = process.env.BUNNY_WEBHOOK_SECRET;
        
        if (!webhookSecret) {
            console.error('[BunnyStreamService] BUNNY_WEBHOOK_SECRET not configured');
            return false;
        }

        const expectedSignature = crypto
            .createHash('sha256')
            .update(webhookSecret + payload)
            .digest('hex');

        // Constant-time comparison to prevent timing attacks
        try {
            return crypto.timingSafeEqual(
                Buffer.from(signature, 'hex'),
                Buffer.from(expectedSignature, 'hex')
            );
        } catch {
            return false;
        }
    }
}
