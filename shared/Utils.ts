import * as fs from 'fs';
import * as path from 'path';

/**
 * Normalise a phone number or JID to a full WhatsApp JID.
 * Strips +, spaces, dashes.
 */
export function normaliseJid(input: string): string {
  if (!input) return '';
  // Already a JID
  if (input.includes('@')) return input;
  const clean = input.replace(/[^0-9]/g, '');
  return `${clean}@s.whatsapp.net`;
}

export function normaliseGroupJid(input: string): string {
  if (!input) return '';
  if (input.includes('@g.us')) return input;
  return `${input}@g.us`;
}

export function jidToPhone(jid: string): string {
  return jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

export function bufferToBase64(buf: Buffer): string {
  return buf.toString('base64');
}

export function base64ToBuffer(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

export async function resolveMediaBuffer(
  type: 'url' | 'binary' | 'base64' | 'path',
  data: string | Buffer,
): Promise<Buffer | { url: string }> {
  switch (type) {
    case 'url':
      return { url: data as string };
    case 'path': {
      const filePath = data as string;
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      return fs.readFileSync(filePath);
    }
    case 'base64':
      return base64ToBuffer(data as string);
    case 'binary':
      return data instanceof Buffer ? data : Buffer.from(data as string, 'binary');
    default:
      throw new Error(`Unknown media type: ${type}`);
  }
}

export function sanitiseSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getMimeTypeForExtension(ext: string): string {
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', pdf: 'application/pdf',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function guessFilename(urlOrPath: string): string {
  return path.basename(urlOrPath) || 'file';
}
