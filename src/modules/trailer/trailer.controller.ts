import { Request, Response, NextFunction } from 'express';
import { TrailerService } from './trailer.service';
import { ApiResponse } from '../../utils/api-response';

const service = new TrailerService();

export class TrailerController {
  getConfig = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.getTrailerConfig(req.user!.userId, req.params.courseId);
      return ApiResponse.success(res, result);
    } catch (e) { next(e); }
  };

  updateConfig = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { trailerEnabled, lectureIds } = req.body;
      const result = await service.updateTrailerConfig(req.user!.userId, req.params.courseId, {
        trailerEnabled: Boolean(trailerEnabled),
        lectureIds: Array.isArray(lectureIds) ? lectureIds : []
      });
      return ApiResponse.success(res, result, 'Trailer config updated');
    } catch (e) { next(e); }
  };

  getStudentTrailer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.getTrailerForStudent(req.params.courseId);
      return ApiResponse.success(res, result);
    } catch (e) { next(e); }
  };
}
