import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';

export interface TestConfig {
  port: number;
  encryptKey: string;
  token: string;
  callbacks?: any[];
}

export function createTempConfigDir(config: TestConfig): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsign-test-'));

  const appJson = {
    server: { port: config.port, host: '0.0.0.0' },
    tsign: { encryptKey: config.encryptKey, token: config.token },
    dispatch: { defaultTimeout: 5000, defaultRetryCount: 0, retryDelay: 500 },
    log: { level: 'info', maxFiles: 5 },
  };

  const callbacksJson = {
    version: 1,
    updatedAt: new Date().toISOString(),
    callbacks: config.callbacks || [],
  };

  const tagsJson = { version: 1, updatedAt: new Date().toISOString(), tags: [] };
  const logsJson = { logs: [] };

  fs.writeFileSync(path.join(tmpDir, 'app.json'), JSON.stringify(appJson, null, 2));
  fs.writeFileSync(path.join(tmpDir, 'callbacks.json'), JSON.stringify(callbacksJson, null, 2));
  fs.writeFileSync(path.join(tmpDir, 'tags.json'), JSON.stringify(tagsJson, null, 2));
  fs.writeFileSync(path.join(tmpDir, 'operation-logs.json'), JSON.stringify(logsJson, null, 2));

  const versionsDir = path.join(tmpDir, 'versions');
  fs.mkdirSync(versionsDir, { recursive: true });

  return tmpDir;
}

export interface DispatcherInstance {
  process: ChildProcess;
  port: number;
  configDir: string;
  logDir: string;
  apiBase: string;
}

export async function startDispatcher(config: TestConfig, configDir: string): Promise<DispatcherInstance> {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsign-log-'));
  const backendDir = path.resolve(__dirname, '../../');

  const child = spawn('npx', ['ts-node-dev', '--transpile-only', '--no-notify', 'src/app.ts'], {
    cwd: backendDir,
    env: {
      ...process.env,
      CONFIG_DIR: configDir,
      LOG_DIR: logDir,
      LOG_LEVEL: 'warn',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });

  const instance: DispatcherInstance = {
    process: child,
    port: config.port,
    configDir,
    logDir,
    apiBase: `http://localhost:${config.port}/api`,
  };

  await waitForReady(config.port, 15000);
  return instance;
}

export async function stopDispatcher(instance: DispatcherInstance): Promise<void> {
  if (!instance) return;
  if (instance.process?.pid) {
    try {
      process.kill(-instance.process.pid, 'SIGTERM');
    } catch {
      try { instance.process.kill('SIGTERM'); } catch { /* already dead */ }
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  cleanupDir(instance.logDir);
}

export async function waitForReady(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await axios.get(`http://localhost:${port}/api/health`, { timeout: 1000 });
      if (res.status === 200) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Dispatcher on port ${port} not ready after ${timeoutMs}ms`);
}

export function cleanupDir(dir: string): void {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // best effort cleanup
  }
}

export async function sendCallback(
  port: number,
  body: any,
  query?: Record<string, string>
): Promise<any> {
  const res = await axios.post(`http://localhost:${port}/api/callback`, body, {
    params: query,
    timeout: 5000,
  });
  return res.data;
}

export async function getReceivedCallbacks(port: number): Promise<any[]> {
  const res = await axios.get(`http://localhost:${port}/api/received-callbacks`, { timeout: 5000 });
  return res.data?.data || [];
}

export async function clearReceivedCallbacks(port: number): Promise<void> {
  await axios.delete(`http://localhost:${port}/api/received-callbacks`, { timeout: 5000 });
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
