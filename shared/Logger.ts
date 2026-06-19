import * as fs from 'fs';
import * as path from 'path';
import { LOGS_DIR } from './Constants';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatEntry(level: LogLevel, sessionId: string, message: string, data?: unknown): string {
  const ts = new Date().toISOString();
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  return `[${ts}] [${level.toUpperCase()}] [${sessionId}] ${message}${dataStr}\n`;
}

export class SessionLogger {
  private logPath: string;

  constructor(private sessionId: string) {
    ensureDir(LOGS_DIR);
    this.logPath = path.join(LOGS_DIR, `${sessionId}.log`);
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    const entry = formatEntry(level, this.sessionId, message, data);
    try {
      fs.appendFileSync(this.logPath, entry, 'utf8');
    } catch {
      // fallback: silently fail if FS unavailable
    }
    if (level === 'error') {
      console.error(`[WA:${this.sessionId}] ${message}`, data ?? '');
    } else if (process.env.WA_DEBUG === '1') {
      console.log(`[WA:${this.sessionId}] [${level}] ${message}`, data ?? '');
    }
  }

  debug(message: string, data?: unknown): void { this.write('debug', message, data); }
  info(message: string, data?: unknown): void { this.write('info', message, data); }
  warn(message: string, data?: unknown): void { this.write('warn', message, data); }
  error(message: string, data?: unknown): void { this.write('error', message, data); }
}

export const rootLogger = new SessionLogger('system');
