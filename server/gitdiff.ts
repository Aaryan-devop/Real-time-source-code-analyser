import { execFileSync } from 'node:child_process';
import path from 'node:path';

let cachedGitCheck: boolean | null = null;

export function isGitAvailable(): boolean {
  if (cachedGitCheck !== null) return cachedGitCheck;
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 2000 });
    cachedGitCheck = true;
  } catch {
    cachedGitCheck = false;
  }
  return cachedGitCheck;
}

export function isGitRepo(dirPath: string): boolean {
  if (!isGitAvailable()) return false;
  try {
    const out = execFileSync('git', ['-C', dirPath, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

export function getModifiedLines(repoRoot: string, filePath: string): Set<number> {
  const modified = new Set<number>();
  if (!isGitAvailable()) return modified;

  let relPath: string;
  try {
    relPath = path.relative(path.resolve(repoRoot), path.resolve(filePath)).split(path.sep).join('/');
  } catch {
    relPath = path.basename(filePath);
  }

  try {
    const stdout = execFileSync('git', ['-C', repoRoot, 'diff', 'HEAD', '-U0', '--', relPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });

    const hunkRegex = /^@@\s+-[0-9]+(?:,[0-9]+)?\s+\+([0-9]+)(?:,([0-9]+))?\s+@@/;
    for (const line of stdout.split(/\r?\n/)) {
      const m = hunkRegex.exec(line);
      if (m) {
        const startLine = Number.parseInt(m[1], 10);
        const count = m[2] !== undefined ? Number.parseInt(m[2], 10) : 1;
        for (let offset = 0; offset < count; offset++) {
          modified.add(startLine + offset);
        }
      }
    }
  } catch {
    // Untracked or non-git file degrades cleanly
  }

  return modified;
}
