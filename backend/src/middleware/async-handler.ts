import { Request, Response, NextFunction } from 'express';
import logger from '../services/logger.service';

/**
 * Wraps an async Express route handler to catch rejected promises
 * and forward them to the global error handler.
 *
 * Usage:
 *   app.get('/api/foo', asyncHandler(myController));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      logger.error(`Unhandled controller error: ${message}`, { stack, path: req.path });
      if (!res.headersSent) {
        res.status(500).json({ code: 500, message: 'Internal server error' });
      }
    });
  };
}
