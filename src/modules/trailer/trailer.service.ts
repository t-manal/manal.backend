import prisma from '../../config/prisma';
import { AppError } from '../../utils/app-error';

export class TrailerService {

  /** INSTRUCTOR: get trailer config for a course */
  async getTrailerConfig(instructorId: string, courseId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        trailerSections: {
          orderBy: { order: 'asc' },
          include: {
            lecture: {
              include: {
                parts: {
                  orderBy: { order: 'asc' },
                  include: {
                    lessons: { orderBy: { order: 'asc' } },
                    files: { orderBy: { order: 'asc' } },
                  }
                }
              }
            }
          }
        },
        lectures: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true }
        }
      }
    });

    if (!course) throw new AppError('Course not found', 404);
    if (course.instructorId !== instructorId) throw new AppError('Access denied', 403);

    return {
      trailerEnabled: course.trailerEnabled,
      selectedLectureIds: course.trailerSections.map(ts => ts.lectureId),
      trailerSections: course.trailerSections,
      allLectures: course.lectures
    };
  }

  /** INSTRUCTOR: save trailer config */
  async updateTrailerConfig(instructorId: string, courseId: string, data: {
    trailerEnabled: boolean;
    lectureIds: string[];
  }) {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new AppError('Course not found', 404);
    if (course.instructorId !== instructorId) throw new AppError('Access denied', 403);

    await prisma.$transaction(async (tx) => {
      await tx.courseTrailerSection.deleteMany({ where: { courseId } });
      await tx.course.update({
        where: { id: courseId },
        data: { trailerEnabled: data.trailerEnabled }
      });
      for (let i = 0; i < data.lectureIds.length; i++) {
        await tx.courseTrailerSection.create({
          data: { courseId, lectureId: data.lectureIds[i], order: i + 1 }
        });
      }
    });

    return this.getTrailerConfig(instructorId, courseId);
  }

  /** STUDENT: get trailer content (requires verified email) */
  async getTrailerForStudent(courseId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId, isPublished: true, trailerEnabled: true },
      include: {
        university: { select: { id: true, name: true, logo: true } },
        trailerSections: {
          orderBy: { order: 'asc' },
          include: {
            lecture: {
              include: {
                parts: {
                  orderBy: { order: 'asc' },
                  include: {
                    lessons: { orderBy: { order: 'asc' } },
                    files: { orderBy: { order: 'asc' } },
                  }
                }
              }
            }
          }
        },
        lectures: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true, _count: { select: { parts: true } } }
        }
      }
    });

    if (!course) throw new AppError('Trailer not found or not enabled', 404);

    return {
      course: {
        id: course.id,
        title: course.title,
        description: course.description,
        thumbnail: course.thumbnail,
        price: course.price,
        university: course.university,
      },
      trailerLectures: course.trailerSections.map(ts => ({
        id: ts.lecture.id,
        title: ts.lecture.title,
        order: ts.order,
        parts: ts.lecture.parts
      })),
      courseOutline: course.lectures,
    };
  }
}
