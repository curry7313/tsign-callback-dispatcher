import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { getConfigDir } from '../config/app.config';
import logger from './logger.service';

interface UserRecord {
  username: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

interface UsersFile {
  users: UserRecord[];
}

const JWT_SECRET = process.env.JWT_SECRET || 'tsign-dispatcher-default-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const BCRYPT_ROUNDS = 10;

function getUsersFilePath(): string {
  return path.join(getConfigDir(), 'users.json');
}

function loadUsers(): UsersFile {
  const filePath = getUsersFilePath();
  if (!fs.existsSync(filePath)) {
    return { users: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as UsersFile;
  } catch {
    return { users: [] };
  }
}

function saveUsers(data: UsersFile): void {
  const filePath = getUsersFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Initialize default admin user if no users exist.
 * Default: admin / admin123 (MUST be changed on first login in production)
 */
export function initDefaultUser(): void {
  const data = loadUsers();
  if (data.users.length === 0) {
    const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
    const hash = bcrypt.hashSync(defaultPassword, BCRYPT_ROUNDS);
    data.users.push({
      username: 'admin',
      passwordHash: hash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    saveUsers(data);
    logger.info('Default admin user created (username: admin). Please change the password immediately.');
  }
}

export function authenticate(username: string, password: string): string | null {
  const data = loadUsers();
  const user = data.users.find((u) => u.username === username);
  if (!user) {
    return null;
  }
  if (!bcrypt.compareSync(password, user.passwordHash)) {
    return null;
  }
  const token = jwt.sign({ username: user.username }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as string | number,
  } as jwt.SignOptions);
  return token;
}

export function verifyToken(token: string): { username: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { username: string };
    return decoded;
  } catch {
    return null;
  }
}

export function changePassword(username: string, oldPassword: string, newPassword: string): boolean {
  const data = loadUsers();
  const user = data.users.find((u) => u.username === username);
  if (!user) {
    return false;
  }
  if (!bcrypt.compareSync(oldPassword, user.passwordHash)) {
    return false;
  }
  user.passwordHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
  user.updatedAt = new Date().toISOString();
  saveUsers(data);
  logger.info(`Password changed for user: ${username}`);
  return true;
}
