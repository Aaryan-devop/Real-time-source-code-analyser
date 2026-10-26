import fs from 'node:fs';
import path from 'node:path';
import { settings } from './config.ts';

export const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  'venv',
  '.venv',
  'env',
  'dist',
  'build',
  '.idea',
  '.vscode',
  '.pytest_cache',
  '.mypy_cache',
]);

export const SUPPORTED_EXTENSIONS = new Set([
  '.py',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.toml',
  '.txt',
  '.yaml',
  '.yml',
]);

export function isIgnoredPath(targetPath: string, rootDir?: string): boolean {
  const rel = rootDir ? path.relative(rootDir, targetPath) : targetPath;
  const parts = rel.split(path.sep).filter(Boolean);

  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) return true;
    if (part.startsWith('.') && part !== '.env') return true;
  }

  const base = path.basename(targetPath).toLowerCase();
  const ext = path.extname(targetPath).toLowerCase();
  const isManifest = base === 'requirements.txt' || base === 'package.json' || base === 'pyproject.toml';

  try {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) return false;
    if (!SUPPORTED_EXTENSIONS.has(ext) && !isManifest) return true;
    if (stat.size > settings.MAX_FILE_SIZE_BYTES) return true;
  } catch {
    // Deleted file: check extension before filtering out
    if (!SUPPORTED_EXTENSIONS.has(ext) && !isManifest) return true;
  }

  return false;
}

export class ProjectWatcher {
  private debounceMs: number;
  private watchers: fs.FSWatcher[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  watchedPath: string | null = null;
  onChange: (filePath: string) => void = () => {};
  onDelete: (filePath: string) => void = () => {};

  constructor(debounceMs = 300) {
    this.debounceMs = debounceMs;
  }

  get isRunning(): boolean {
    return this.watchers.length > 0 && this.watchedPath !== null;
  }

  start(targetDir: string): void {
    this.stop();
    const resolved = path.resolve(targetDir);
    this.watchedPath = resolved;

    // Attach watchers recursively across subdirectories for cross-platform reliability on Linux & macOS
    this.watchDirectoryTree(resolved, resolved);
  }

  private watchDirectoryTree(dir: string, rootDir: string): void {
    try {
      const watcher = fs.watch(dir, (_eventType, filename) => {
        if (!filename) return;
        const fullPath = path.resolve(dir, String(filename));
        if (isIgnoredPath(fullPath, rootDir)) return;

        // If a new subdirectory was created, attach a watcher to it as well
        try {
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            this.watchDirectoryTree(fullPath, rootDir);
            return;
          }
        } catch {
          // Ignore transient stat race
        }

        this.scheduleDebounced(fullPath);
      });

      watcher.on('error', () => {
        // Ignore OS watch descriptor recycling errors
      });
      this.watchers.push(watcher);

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          this.watchDirectoryTree(path.join(dir, entry.name), rootDir);
        }
      }
    } catch {
      // Directory inaccessible
    }
  }

  private scheduleDebounced(filePath: string): void {
    const existing = this.timers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(filePath);
      if (fs.existsSync(filePath)) {
        try {
          if (fs.statSync(filePath).isFile()) {
            this.onChange(filePath);
          }
        } catch {
          // Ignore transient race
        }
      } else {
        this.onDelete(filePath);
      }
    }, this.debounceMs);

    this.timers.set(filePath, timer);
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        // Ignore close error
      }
    }
    this.watchers = [];
    this.watchedPath = null;
  }

  scanFiles(
    onFile?: (filePath: string) => void,
    onProgress?: (current: number, total: number, fileName: string) => void
  ): string[] {
    if (!this.watchedPath || !fs.existsSync(this.watchedPath)) return [];

    const collected: string[] = [];
    const rootDir = this.watchedPath;

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
        } else if (entry.isFile()) {
          if (!isIgnoredPath(full, rootDir)) {
            collected.push(full);
          }
        }
      }
    };

    walk(rootDir);
    collected.sort();

    const total = collected.length;
    for (let i = 0; i < total; i++) {
      const fp = collected[i];
      if (onFile) onFile(fp);
      if (onProgress) onProgress(i + 1, total, path.relative(rootDir, fp));
    }

    return collected;
  }
}
