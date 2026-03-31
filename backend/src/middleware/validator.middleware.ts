import { Request, Response, NextFunction } from 'express';

export function validateCallbackBody(req: Request, res: Response, next: NextFunction): void {
  const { name, url } = req.body;
  const errors: string[] = [];
  const isUpdate = req.method === 'PUT';

  if (!isUpdate) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      errors.push('name is required');
    }
    if (!url || typeof url !== 'string') {
      errors.push('url is required');
    } else {
      const urlPattern = /^https?:\/\/.+/;
      if (!urlPattern.test(url)) {
        errors.push('url must be a valid HTTP/HTTPS URL');
      }
    }
  } else {
    if (url !== undefined) {
      if (typeof url !== 'string' || !/^https?:\/\/.+/.test(url)) {
        errors.push('url must be a valid HTTP/HTTPS URL');
      }
    }
  }

  if (errors.length > 0) {
    res.status(400).json({ code: 400, message: errors.join(', ') });
    return;
  }
  next();
}

export function validateTagBody(req: Request, res: Response, next: NextFunction): void {
  const { name, key, type } = req.body;
  const errors: string[] = [];

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('name is required');
  }
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    errors.push('key is required');
  } else if (!/^[a-zA-Z0-9_.]+$/.test(key)) {
    errors.push('key must only contain letters, numbers, underscores, and dots');
  }
  if (type && !['text', 'select'].includes(type)) {
    errors.push('type must be "text" or "select"');
  }

  if (errors.length > 0) {
    res.status(400).json({ code: 400, message: errors.join(', ') });
    return;
  }
  next();
}
