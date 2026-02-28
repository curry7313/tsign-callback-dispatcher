import path from 'path';
import fs from 'fs';
import { AppConfig } from '../types/config.types';

const CONFIG_DIR = process.env.CONFIG_DIR || path.resolve(__dirname, '../../../config');

const defaultConfig: AppConfig = {
  server: { port: 3001, host: '0.0.0.0' },
  tsign: { encryptKey: '', token: '' },
  dispatch: { defaultTimeout: 10000, defaultRetryCount: 3, retryDelay: 1000 },
  log: { level: 'info', maxFiles: 30 },
};

let _appConfig: AppConfig;

export function loadAppConfig(): AppConfig {
  const configPath = path.join(CONFIG_DIR, 'app.json');
  if (!fs.existsSync(configPath)) {
    return { ...defaultConfig };
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  return { ...defaultConfig, ...JSON.parse(raw) };
}

export function saveAppConfig(config: AppConfig): void {
  const configPath = path.join(CONFIG_DIR, 'app.json');
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  _appConfig = config;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

_appConfig = loadAppConfig();

export { _appConfig as appConfig };
