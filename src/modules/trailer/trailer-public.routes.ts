import { Router } from 'express';
import { TrailerPublicController } from './trailer-public.controller';
import { publicRateLimiter } from '../../middlewares/rate-limit.middleware';

const router = Router();
const controller = new TrailerPublicController();

router.get('/', publicRateLimiter, (req, res, next) => controller.getCoursesWithTrailer(req, res, next));
router.get('/:courseId', publicRateLimiter, (req, res, next) => controller.getCourseTrailer(req, res, next));

export default router;

