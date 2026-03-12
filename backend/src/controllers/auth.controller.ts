import { Request, Response } from 'express';
import { authenticate, changePassword } from '../services/auth.service';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import logger from '../services/logger.service';

export function login(req: Request, res: Response): void {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ code: 400, message: 'Username and password are required' });
    return;
  }

  const token = authenticate(username, password);
  if (!token) {
    logger.warn(`Failed login attempt for user: ${username}`);
    res.status(401).json({ code: 401, message: 'Invalid username or password' });
    return;
  }

  logger.info(`User logged in: ${username}`);
  res.json({ code: 0, message: 'Login successful', data: { token, username } });
}

export function updatePassword(req: AuthenticatedRequest, res: Response): void {
  const { oldPassword, newPassword } = req.body;
  const username = req.user?.username;

  if (!username) {
    res.status(401).json({ code: 401, message: 'Authentication required' });
    return;
  }

  if (!oldPassword || !newPassword) {
    res.status(400).json({ code: 400, message: 'Old and new passwords are required' });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ code: 400, message: 'Password must be at least 8 characters' });
    return;
  }

  const success = changePassword(username, oldPassword, newPassword);
  if (!success) {
    res.status(400).json({ code: 400, message: 'Old password is incorrect' });
    return;
  }

  res.json({ code: 0, message: 'Password updated successfully' });
}

export function getProfile(req: AuthenticatedRequest, res: Response): void {
  res.json({ code: 0, message: 'success', data: { username: req.user?.username } });
}
