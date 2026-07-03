import * as fs from 'fs';
import * as path from 'path';

/**
 * Generic, namespaced storage helpers. The Legacy backend deliberately
 * keeps using its own original `shared/SessionStore.ts` /
 * `shared/MetadataStore.ts` / `shared/QRGenerator.ts` untouched (rooted at
 * `~/.n8n/whatsapp/`) so existing installs are byte-for-byte unaffected.
 *
 * The Official backend uses this module, rooted at a **separate**
 * directory tree (`~/.n8n/whatsapp-official/`), so official-backend auth
 * state (different credential/key format) can never collide with, or be
 * accidentally overwritten by, legacy session files.
 */

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function makeSessionDirHelpers(sessionsRoot: string) {
  return {
    getSessionDir(sessionId: string): string {
      return path.join(sessionsRoot, sessionId);
    },
    ensureSessionDir(sessionId: string): string {
      const dir = path.join(sessionsRoot, sessionId);
      ensureDir(dir);
      return dir;
    },
    sessionExists(sessionId: string): boolean {
      const dir = path.join(sessionsRoot, sessionId);
      if (!fs.existsSync(dir)) return false;
      return fs.readdirSync(dir).some(f => f.endsWith('.json'));
    },
    listSessionIds(): string[] {
      if (!fs.existsSync(sessionsRoot)) return [];
      return fs.readdirSync(sessionsRoot).filter(name => {
        const full = path.join(sessionsRoot, name);
        return fs.statSync(full).isDirectory();
      });
    },
    deleteSessionFiles(sessionId: string): void {
      const dir = path.join(sessionsRoot, sessionId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export class JsonMetadataStore<T extends { sessionId: string }> {
  private data: Record<string, T> = {};

  constructor(private filePath: string, private makeDefault: (sessionId: string) => T) {
    ensureDir(path.dirname(filePath));
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Record<string, T>;
      } catch {
        this.data = {};
      }
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      /* non-fatal: metadata is a cache, not the source of truth */
    }
  }

  get(sessionId: string): T | undefined {
    return this.data[sessionId];
  }

  update(sessionId: string, partial: Partial<T>): void {
    if (!this.data[sessionId]) this.data[sessionId] = this.makeDefault(sessionId);
    Object.assign(this.data[sessionId], partial);
    this.save();
  }

  delete(sessionId: string): void {
    delete this.data[sessionId];
    this.save();
  }

  listIds(): string[] {
    return Object.keys(this.data);
  }
}

// ── QR rendering (pure JS BMP encoder, no native deps) ──────────────────
// Mirrors shared/QRGenerator.ts's approach so both backends produce the
// same lightweight, dependency-free QR image format.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encode } = require('uqr') as { encode: (text: string, opts?: { ecc?: string }) => { size: number; data: boolean[][] } };

function matrixToBmp(matrix: boolean[][], scale = 8): Buffer {
  const size = matrix.length;
  const imgWidth = size * scale;
  const imgHeight = size * scale;
  const rowSize = Math.ceil((imgWidth * 3) / 4) * 4;
  const pixelArraySize = rowSize * imgHeight;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize, 0xff);

  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(imgWidth, 18);
  buf.writeInt32LE(-imgHeight, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  const dataOffset = 54;
  for (let row = 0; row < imgHeight; row++) {
    const matRow = Math.floor(row / scale);
    for (let col = 0; col < imgWidth; col++) {
      const matCol = Math.floor(col / scale);
      const dark = matrix[matRow]?.[matCol] ?? false;
      const byteOffset = dataOffset + row * rowSize + col * 3;
      const color = dark ? 0x00 : 0xff;
      buf[byteOffset] = color;
      buf[byteOffset + 1] = color;
      buf[byteOffset + 2] = color;
    }
  }
  return buf;
}

export async function generateQRBuffer(qrText: string): Promise<Buffer> {
  const { data } = encode(qrText, { ecc: 'M' });
  return matrixToBmp(data, 8);
}

export async function generateQRImageFile(qrText: string, sessionId: string, qrCacheDir: string): Promise<string> {
  ensureDir(qrCacheDir);
  const filePath = path.join(qrCacheDir, `${sessionId}.bmp`);
  const buf = await generateQRBuffer(qrText);
  fs.writeFileSync(filePath, buf);
  return filePath;
}
