import { Router } from 'express';
import { BunnyWebhookController } from './bunny-webhook.controller';

const router = Router();
const controller = new BunnyWebhookController();

/**
 * Bunny Stream Webhook Routes
 * 
 * These endpoints receive webhook events from Bunny Stream.
 * They are PUBLIC but protected by webhook signature verification.
 * 
 * SECURITY: No auth middleware - signature verification happens in controller
 */

// POST /api/v1/webhooks/bunny
// Receives all Bunny Stream events (video encoded, transcoded, error, etc.)
router.post('/bunny', controller.handleWebhook.bind(controller));

export default router;
