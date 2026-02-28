import fs from 'fs';
import path from 'path';

type FileChangeCallback = (filePath: string) => void;

const watchers = new Map<string, fs.FSWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();

export function watchFile(filePath: string, callback: FileChangeCallback, debounceMs = 500): void {
  const resolvedPath = path.resolve(filePath);

  // Close existing watcher
  if (watchers.has(resolvedPath)) {
    watchers.get(resolvedPath)?.close();
  }

  const watcher = fs.watch(resolvedPath, (eventType) => {
    if (eventType === 'change') {
      // Debounce
      const existing = debounceTimers.get(resolvedPath);
      if (existing) clearTimeout(existing);

      debounceTimers.set(
        resolvedPath,
        setTimeout(() => {
          callback(resolvedPath);
          debounceTimers.delete(resolvedPath);
        }, debounceMs)
      );
    }
  });

  watchers.set(resolvedPath, watcher);
}

export function unwatchFile(filePath: string): void {
  const resolvedPath = path.resolve(filePath);
  const watcher = watchers.get(resolvedPath);
  if (watcher) {
    watcher.close();
    watchers.delete(resolvedPath);
  }
  const timer = debounceTimers.get(resolvedPath);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(resolvedPath);
  }
}

export function unwatchAll(): void {
  watchers.forEach((watcher) => watcher.close());
  watchers.clear();
  debounceTimers.forEach((timer) => clearTimeout(timer));
  debounceTimers.clear();
}
