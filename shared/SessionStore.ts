import * as fs from 'fs';
import * as path from 'path';
import { SESSIONS_DIR } from './Constants';

export function getSessionDir(sessionId: string): string {
  return path.join(SESSIONS_DIR, sessionId);
}

export function ensureSessionDir(sessionId: string): string {
  const dir = getSessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function sessionExists(sessionId: string): boolean {
  const dir = getSessionDir(sessionId);
  if (!fs.existsSync(dir)) return false;
  const files = fs.readdirSync(dir);
  return files.some((f: string) => f.endsWith('.json'));
}

export function listSessionIds(): string[] {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  return fs.readdirSync(SESSIONS_DIR).filter((name: string) => {
    const full = path.join(SESSIONS_DIR, name);
    return fs.statSync(full).isDirectory();
  });
}

export function deleteSessionFiles(sessionId: string): void {
  const dir = getSessionDir(sessionId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function getSessionFileSizes(sessionId: string): Record<string, number> {
  const dir = getSessionDir(sessionId);
  if (!fs.existsSync(dir)) return {};
  const result: Record<string, number> = {};
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    result[f] = fs.statSync(full).size;
  }
  return result;
}
