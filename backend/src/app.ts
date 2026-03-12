import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { appConfig } from './config/app.config';
import { requestLogger } from './middleware/logger.middleware';
import { authRequired } from './middleware/auth.middleware';
import { validateCallbackBody, validateTagBody } from './middleware/validator.middleware';
import { handleCallback, getReceivedCallbacks, clearReceivedCallbacks } from './controllers/callback.controller';
import * as configCtrl from './controllers/config.controller';
import * as authCtrl from './controllers/auth.controller';
import { healthCheck } from './controllers/health.controller';
import { initConfigWatcher } from './services/config.service';
import { initDefaultUser } from './services/auth.service';
import logger from './services/logger.service';

const app = express();

// ──── Security Middleware ────
app.use(helmet({
  contentSecurityPolicy: false, // Let nginx handle CSP for the frontend
}));

// CORS: restrict to configured origins in production
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
  : undefined;

app.use(cors(
  allowedOrigins
    ? { origin: allowedOrigins, credentials: true }
    : undefined // dev: allow all
));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// ──── Rate Limiting ────
// Login endpoint: strict rate limit to prevent brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { code: 429, message: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,
  message: { code: 429, message: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limit to all /api/ routes except callback (high-throughput)
app.use('/api/', (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/callback') return next();
  return apiLimiter(req, res, next);
});

// ──── Public Routes (no auth) ────
// Health check
app.get('/api/health', healthCheck);

// TSign callback endpoint (called by e-sign platform, must be public)
app.post('/api/callback', handleCallback);

// Auth routes
app.post('/api/auth/login', loginLimiter, authCtrl.login);

// ──── Protected Routes (auth required) ────
app.use('/api/auth/profile', authRequired);
app.get('/api/auth/profile', authCtrl.getProfile);

app.use('/api/auth/password', authRequired);
app.put('/api/auth/password', authCtrl.updatePassword);

// Protect all management APIs
app.get('/api/received-callbacks', authRequired, getReceivedCallbacks);
app.delete('/api/received-callbacks', authRequired, clearReceivedCallbacks);

// Callback config CRUD
app.get('/api/callbacks/generate-keys', authRequired, configCtrl.generateKeys);
app.get('/api/callbacks', authRequired, configCtrl.getCallbacks);
app.get('/api/callbacks/:id', authRequired, configCtrl.getCallback);
app.post('/api/callbacks', authRequired, validateCallbackBody, configCtrl.createCallback);
app.put('/api/callbacks/:id', authRequired, validateCallbackBody, configCtrl.editCallback);
app.delete('/api/callbacks/:id', authRequired, configCtrl.removeCallback);

// Tag config CRUD
app.get('/api/tags', authRequired, configCtrl.getTags);
app.get('/api/tags/:id', authRequired, configCtrl.getTag);
app.post('/api/tags', authRequired, validateTagBody, configCtrl.createTag);
app.put('/api/tags/:id', authRequired, validateTagBody, configCtrl.editTag);
app.delete('/api/tags/:id', authRequired, configCtrl.removeTag);

// Logs
app.get('/api/logs', authRequired, configCtrl.getLogs);

// TSign config (encryptKey / token)
app.get('/api/tsign-config', authRequired, configCtrl.getTSignConfig);
app.put('/api/tsign-config', authRequired, configCtrl.updateTSignConfig);

// Config versions
app.get('/api/versions/:type', authRequired, configCtrl.getVersions);
app.post('/api/versions/:type/rollback', authRequired, configCtrl.rollback);

// Initialize config file watcher and default user
initConfigWatcher();
initDefaultUser();

// ──── Global error handling middleware ────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(`Unhandled route error: ${err.message}`, { stack: err.stack });
  if (!res.headersSent) {
    res.status(500).json({ code: 500, message: 'Internal server error' });
  }
});

// ──── Process-level crash protection ────
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception (process survived): ${err.message}`, { stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error(`Unhandled promise rejection: ${msg}`, { stack });
});

// Start server
const { port, host } = appConfig.server;
app.listen(port, host, () => {
  logger.info(`TSign Callback Dispatcher backend running at http://${host}:${port}`);
});

export default app;
