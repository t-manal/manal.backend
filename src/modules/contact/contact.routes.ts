import { Router } from 'express';
import { ContactController } from './contact.controller';
import { contactRateLimiter } from '../../middlewares/rate-limit.middleware';

const router = Router();
const contactController = new ContactController();

router.post('/', contactRateLimiter, (req, res, next) => contactController.send(req, res, next));

export default router;
