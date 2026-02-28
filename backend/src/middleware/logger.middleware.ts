import { Request, Response, NextFunction } from 'express';
import logger from '../services/logger.service';

const SILENT_PATHS = ['/api/health'];

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (SILENT_PATHS.includes(req.path)) {
    return next();
  }

  const start = Date.now();
  const { method, url } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${method} ${url} ${res.statusCode} ${duration}ms`);
  });

  next();
}
