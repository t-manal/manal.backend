import { Router } from 'express';
import { InstructorContentController } from './instructor-content.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requirePanelRole } from '../../middlewares/rbac.middleware';
import { Role } from '@prisma/client';

const router = Router();
const controller = new InstructorContentController();

// Use middleware for all instructor routes
router.use(authMiddleware);
router.use(requirePanelRole);

// Courses
router.get('/courses', controller.getMyCourses);
router.post('/courses', controller.createCourse);
router.get('/courses/:id', controller.getCourse);
router.patch('/courses/:id', controller.updateCourse);
router.delete('/courses/:id', controller.deleteCourse);
router.get('/courses/:courseId/students', controller.getCourseStudents);

// Sections
router.post('/courses/:courseId/sections', controller.createSection);
router.patch('/sections/:id', controller.updateSection);
router.delete('/sections/:id', controller.deleteSection);
router.post('/sections/:id/asset-container', controller.ensureLectureAssetContainer);

// Lessons
router.post('/sections/:sectionId/lessons', controller.createLesson);
router.get('/lessons/:id', controller.getLesson);
router.patch('/lessons/:id', controller.updateLesson);
router.delete('/lessons/:id', controller.deleteLesson);
router.post('/lessons/:id/move-assets-to-lecture', controller.moveLessonAssetsToLecture);

// Assets
router.post('/lessons/:lessonId/assets', controller.createAsset);
router.patch('/assets/:id', controller.updateAsset);
router.delete('/assets/:id', controller.deleteAsset);

// Students
// Students
router.get('/students', controller.getStudents);
router.get('/students/:studentId', controller.getStudent);


export default router;

