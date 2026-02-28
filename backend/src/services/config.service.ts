import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  CallbacksConfig,
  TagsConfig,
  DispatchConfig,
  TagDefinition,
  OperationLog,
  ConfigVersion,
} from '../types/config.types';
import { getConfigDir } from '../config/app.config';
import { watchFile } from '../utils/file-watcher.util';
import logger from './logger.service';

const CONFIG_DIR = getConfigDir();
const CALLBACKS_FILE = path.join(CONFIG_DIR, 'callbacks.json');
const TAGS_FILE = path.join(CONFIG_DIR, 'tags.json');
const LOGS_FILE = path.join(CONFIG_DIR, 'operation-logs.json');
const VERSIONS_DIR = path.join(CONFIG_DIR, 'versions');

let callbacksCache: CallbacksConfig | null = null;
let tagsCache: TagsConfig | null = null;
let operationLogs: OperationLog[] = [];

// Ensure directories exist
if (!fs.existsSync(VERSIONS_DIR)) {
  fs.mkdirSync(VERSIONS_DIR, { recursive: true });
}

// 内置标签定义
const BUILT_IN_TAGS: Array<Omit<TagDefinition, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    name: '合同类型',
    key: 'FlowType',
    type: 'text',
    color: '#0052d9',
    description: '合同相关回调中的 FlowType 字段，用于按合同类型过滤分发',
    builtIn: true,
    fieldPath: 'MsgData.FlowType',
  },
  {
    name: '自定义数据',
    key: 'UserData',
    type: 'text',
    color: '#e37318',
    description: '合同相关回调中的 UserData 字段，用于按自定义业务数据过滤分发',
    builtIn: true,
    fieldPath: 'MsgData.UserData',
  },
];

function ensureBuiltInTags(): void {
  const tags = getTagsConfig();
  let changed = false;
  for (const builtIn of BUILT_IN_TAGS) {
    const existing = tags.tags.find((t) => t.key === builtIn.key && t.builtIn);
    if (!existing) {
      const now = new Date().toISOString();
      tags.tags.unshift({
        ...builtIn,
        id: uuidv4(),
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
      logger.info(`Built-in tag "${builtIn.name}" (${builtIn.key}) initialized`);
    }
  }
  if (changed) {
    tags.updatedAt = new Date().toISOString();
    tags.version++;
    writeJsonFile(TAGS_FILE, tags);
    tagsCache = tags;
  }
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function writeJsonFile(filePath: string, data: any): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

const MAX_OPERATION_LOGS = 500;
let logWriteTimer: ReturnType<typeof setTimeout> | null = null;

function flushLogsToFile(): void {
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(operationLogs, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`Failed to flush operation logs: ${err}`);
  }
  logWriteTimer = null;
}

function addLog(type: OperationLog['type'], action: string, detail: string): void {
  const log: OperationLog = {
    id: uuidv4(),
    type,
    action,
    detail,
    timestamp: new Date().toISOString(),
  };
  operationLogs.unshift(log);
  if (operationLogs.length > MAX_OPERATION_LOGS) {
    operationLogs = operationLogs.slice(0, MAX_OPERATION_LOGS);
  }
  // Debounce file writes: batch rapid config changes into a single write
  if (!logWriteTimer) {
    logWriteTimer = setTimeout(flushLogsToFile, 500);
  }
}

const MAX_VERSIONS = 50;

function saveConfigVersion(configType: string, data: any, changes: string): void {
  // Count existing version files without reading their content
  const prefix = `${configType}-v`;
  let files: string[] = [];
  if (fs.existsSync(VERSIONS_DIR)) {
    files = fs.readdirSync(VERSIONS_DIR)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .sort();
  }
  const nextVersion = files.length + 1;
  const version: ConfigVersion = {
    version: nextVersion,
    timestamp: new Date().toISOString(),
    changes,
    data,
  };
  const versionFile = path.join(VERSIONS_DIR, `${prefix}${nextVersion}.json`);
  writeJsonFile(versionFile, version);

  // Prune oldest versions if exceeding limit
  if (files.length >= MAX_VERSIONS) {
    const toDelete = files.slice(0, files.length - MAX_VERSIONS + 1);
    for (const f of toDelete) {
      try { fs.unlinkSync(path.join(VERSIONS_DIR, f)); } catch { /* ignore */ }
    }
  }
}

// ========== Callbacks ==========
export function getCallbacksConfig(): CallbacksConfig {
  if (!callbacksCache) {
    callbacksCache = readJsonFile<CallbacksConfig>(CALLBACKS_FILE, {
      version: 1,
      updatedAt: '',
      callbacks: [],
    });
  }
  return callbacksCache;
}

export function getCallbackById(id: string): DispatchConfig | undefined {
  return getCallbacksConfig().callbacks.find((c) => c.id === id);
}

export function addCallback(config: Omit<DispatchConfig, 'id' | 'createdAt' | 'updatedAt'>): DispatchConfig {
  const callbacks = getCallbacksConfig();
  const now = new Date().toISOString();
  const newConfig: DispatchConfig = {
    ...config,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  callbacks.callbacks.push(newConfig);
  callbacks.updatedAt = now;
  callbacks.version++;
  writeJsonFile(CALLBACKS_FILE, callbacks);
  callbacksCache = callbacks;
  saveConfigVersion('callbacks', callbacks, `Added callback: ${newConfig.name}`);
  addLog('config_change', 'add_callback', `Added callback "${newConfig.name}" (${newConfig.url})`);
  return newConfig;
}

export function updateCallback(id: string, updates: Partial<DispatchConfig>): DispatchConfig | null {
  const callbacks = getCallbacksConfig();
  const index = callbacks.callbacks.findIndex((c) => c.id === id);
  if (index === -1) return null;

  const now = new Date().toISOString();
  callbacks.callbacks[index] = { ...callbacks.callbacks[index], ...updates, updatedAt: now };
  callbacks.updatedAt = now;
  callbacks.version++;
  writeJsonFile(CALLBACKS_FILE, callbacks);
  callbacksCache = callbacks;
  saveConfigVersion('callbacks', callbacks, `Updated callback: ${callbacks.callbacks[index].name}`);
  addLog('config_change', 'update_callback', `Updated callback "${callbacks.callbacks[index].name}"`);
  return callbacks.callbacks[index];
}

export function deleteCallback(id: string): boolean {
  const callbacks = getCallbacksConfig();
  const index = callbacks.callbacks.findIndex((c) => c.id === id);
  if (index === -1) return false;

  const deleted = callbacks.callbacks.splice(index, 1)[0];
  callbacks.updatedAt = new Date().toISOString();
  callbacks.version++;
  writeJsonFile(CALLBACKS_FILE, callbacks);
  callbacksCache = callbacks;
  saveConfigVersion('callbacks', callbacks, `Deleted callback: ${deleted.name}`);
  addLog('config_change', 'delete_callback', `Deleted callback "${deleted.name}" (${deleted.url})`);
  return true;
}

// ========== Tags ==========
export function getTagsConfig(): TagsConfig {
  if (!tagsCache) {
    tagsCache = readJsonFile<TagsConfig>(TAGS_FILE, {
      version: 1,
      updatedAt: '',
      tags: [],
    });
  }
  return tagsCache;
}

export function getTagById(id: string): TagDefinition | undefined {
  return getTagsConfig().tags.find((t) => t.id === id);
}

export function addTag(tag: Omit<TagDefinition, 'id' | 'createdAt' | 'updatedAt'>): TagDefinition {
  const tags = getTagsConfig();
  const now = new Date().toISOString();
  const newTag: TagDefinition = {
    ...tag,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  tags.tags.push(newTag);
  tags.updatedAt = now;
  tags.version++;
  writeJsonFile(TAGS_FILE, tags);
  tagsCache = tags;
  addLog('config_change', 'add_tag', `Added tag "${newTag.name}"`);
  return newTag;
}

export function updateTag(id: string, updates: Partial<TagDefinition>): TagDefinition | null {
  const tags = getTagsConfig();
  const index = tags.tags.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const now = new Date().toISOString();
  tags.tags[index] = { ...tags.tags[index], ...updates, updatedAt: now };
  tags.updatedAt = now;
  tags.version++;
  writeJsonFile(TAGS_FILE, tags);
  tagsCache = tags;
  addLog('config_change', 'update_tag', `Updated tag "${tags.tags[index].name}"`);
  return tags.tags[index];
}

export function deleteTag(id: string): boolean {
  const tags = getTagsConfig();
  const index = tags.tags.findIndex((t) => t.id === id);
  if (index === -1) return false;

  // 内置标签不允许删除
  if (tags.tags[index].builtIn) return false;

  const deleted = tags.tags.splice(index, 1)[0];
  tags.updatedAt = new Date().toISOString();
  tags.version++;
  writeJsonFile(TAGS_FILE, tags);
  tagsCache = tags;
  addLog('config_change', 'delete_tag', `Deleted tag "${deleted.name}"`);
  return true;
}

// ========== Logs & Versions ==========
export function getOperationLogs(limit = 100, offset = 0): { logs: OperationLog[]; total: number } {
  if (operationLogs.length === 0) {
    operationLogs = readJsonFile<OperationLog[]>(LOGS_FILE, []);
  }
  return {
    logs: operationLogs.slice(offset, offset + limit),
    total: operationLogs.length,
  };
}

export function getConfigVersions(configType: string): ConfigVersion[] {
  if (!fs.existsSync(VERSIONS_DIR)) return [];
  const files = fs.readdirSync(VERSIONS_DIR)
    .filter((f) => f.startsWith(`${configType}-v`) && f.endsWith('.json'))
    .sort();
  return files.map((f) => readJsonFile<ConfigVersion>(path.join(VERSIONS_DIR, f), {} as ConfigVersion));
}

export function rollbackConfig(configType: string, version: number): boolean {
  const versionFile = path.join(VERSIONS_DIR, `${configType}-v${version}.json`);
  if (!fs.existsSync(versionFile)) return false;

  const versionData = readJsonFile<ConfigVersion>(versionFile, null as any);
  if (!versionData) return false;

  const targetFile = configType === 'callbacks' ? CALLBACKS_FILE : TAGS_FILE;
  writeJsonFile(targetFile, versionData.data);

  if (configType === 'callbacks') callbacksCache = null;
  else tagsCache = null;

  addLog('config_change', 'rollback', `Rolled back ${configType} to version ${version}`);
  return true;
}

// ========== Hot Reload ==========
export function initConfigWatcher(): void {
  // 确保内置标签存在
  ensureBuiltInTags();

  watchFile(CALLBACKS_FILE, () => {
    logger.info('Callbacks config file changed, reloading...');
    callbacksCache = null;
    getCallbacksConfig();
  });
  watchFile(TAGS_FILE, () => {
    logger.info('Tags config file changed, reloading...');
    tagsCache = null;
    getTagsConfig();
  });
  logger.info('Config file watchers initialized');
}

/** @deprecated Dispatch logs are now written via logger only, not to operation log file */
export function addDispatchLog(_detail: string): void {
  // No-op: dispatch logs should only go through winston logger for performance
}
