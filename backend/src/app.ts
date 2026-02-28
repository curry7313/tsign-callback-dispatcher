import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { appConfig } from './config/app.config';
import { requestLogger } from './middleware/logger.middleware';
import { validateCallbackBody, validateTagBody } from './middleware/validator.middleware';
import { handleCallback, getReceivedCallbacks, clearReceivedCallbacks } from './controllers/callback.controller';
import * as configCtrl from './controllers/config.controller';
import { healthCheck } from './controllers/health.controller';
import { initConfigWatcher } from './services/config.service';
import logger from './services/logger.service';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Health check
app.get('/api/health', healthCheck);

// TSign callback endpoint
app.post('/api/callback', handleCallback);
app.get('/api/received-callbacks', getReceivedCallbacks);
app.delete('/api/received-callbacks', clearReceivedCallbacks);

// Callback config CRUD
app.get('/api/callbacks/generate-keys', configCtrl.generateKeys);
app.get('/api/callbacks', configCtrl.getCallbacks);
app.get('/api/callbacks/:id', configCtrl.getCallback);
app.post('/api/callbacks', validateCallbackBody, configCtrl.createCallback);
app.put('/api/callbacks/:id', validateCallbackBody, configCtrl.editCallback);
app.delete('/api/callbacks/:id', configCtrl.removeCallback);

// Tag config CRUD
app.get('/api/tags', configCtrl.getTags);
app.get('/api/tags/:id', configCtrl.getTag);
app.post('/api/tags', validateTagBody, configCtrl.createTag);
app.put('/api/tags/:id', validateTagBody, configCtrl.editTag);
app.delete('/api/tags/:id', configCtrl.removeTag);

// Logs
app.get('/api/logs', configCtrl.getLogs);

// TSign config (encryptKey / token)
app.get('/api/tsign-config', configCtrl.getTSignConfig);
app.put('/api/tsign-config', configCtrl.updateTSignConfig);

// Config versions
app.get('/api/versions/:type', configCtrl.getVersions);
app.post('/api/versions/:type/rollback', configCtrl.rollback);

// Initialize config file watcher
initConfigWatcher();

// ──── Global error handling middleware ────
// Must be registered AFTER all routes (4-arg signature tells Express this is an error handler)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(`Unhandled route error: ${err.message}`, { stack: err.stack });
  if (!res.headersSent) {
    res.status(500).json({ code: 500, message: 'Internal server error' });
  }
});

// ──── Process-level crash protection ────
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception (process survived): ${err.message}`, { stack: err.stack });
  // Don't exit — keep serving. The error is logged for investigation.
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
