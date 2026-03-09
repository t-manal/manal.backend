import { Router } from 'express';
import { trailerPublicController } from './trailer-public.controller';
import { publicRateLimiter } from '../../middlewares/rate-limit.middleware';

const router = Router();

router.get('/', publicRateLimiter, trailerPublicController.getCoursesWithTrailer);
router.get('/:courseId', publicRateLimiter, trailerPublicController.getCourseTrailer);

export default router;
