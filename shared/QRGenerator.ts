import * as fs from 'fs';
import * as path from 'path';
import { QR_CACHE_DIR } from './Constants';
import { rootLogger } from './Logger';

// Pure-JS QR encoder — no native binaries, no sharp, no canvas.
// We use 'uqr' which is a zero-dependency ESM/CJS QR matrix generator,
// then render the matrix to a minimal BMP (also pure JS) so we can
// return a real image buffer without any native image library.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encode } = require('uqr') as { encode: (text: string, opts?: { ecc?: string }) => { size: number; data: boolean[][] } };

function ensureQRDir(): void {
  if (!fs.existsSync(QR_CACHE_DIR)) {
    fs.mkdirSync(QR_CACHE_DIR, { recursive: true });
  }
}

/**
 * Render a QR matrix to a 24-bit BMP buffer.
 * BMP is trivially writable in pure JS — no libpng/libvips needed.
 * The resulting file is displayable in all browsers and image viewers.
 */
function matrixToBmp(matrix: boolean[][], scale = 8): Buffer {
  const size = matrix.length;
  const imgWidth = size * scale;
  const imgHeight = size * scale;
  const rowSize = Math.ceil((imgWidth * 3) / 4) * 4; // BMP rows are 4-byte aligned
  const pixelArraySize = rowSize * imgHeight;
  const fileSize = 54 + pixelArraySize;

  const buf = Buffer.alloc(fileSize, 0xff);

  // BMP file header (14 bytes)
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);        // reserved
  buf.writeUInt32LE(54, 10);      // pixel data offset

  // DIB header — BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(imgWidth, 18);
  buf.writeInt32LE(-imgHeight, 22); // negative = top-down
  buf.writeUInt16LE(1, 26);         // color planes
  buf.writeUInt16LE(24, 28);        // bits per pixel
  buf.writeUInt32LE(0, 30);         // no compression
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);       // X pixels per metre (~72 dpi)
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  // Pixel data
  const dataOffset = 54;
  for (let row = 0; row < imgHeight; row++) {
    const matRow = Math.floor(row / scale);
    for (let col = 0; col < imgWidth; col++) {
      const matCol = Math.floor(col / scale);
      const dark = matrix[matRow]?.[matCol] ?? false;
      const byteOffset = dataOffset + row * rowSize + col * 3;
      const color = dark ? 0x00 : 0xff;
      buf[byteOffset] = color;     // B
      buf[byteOffset + 1] = color; // G
      buf[byteOffset + 2] = color; // R
    }
  }

  return buf;
}

function buildMatrix(qrText: string): boolean[][] {
  const result = encode(qrText, { ecc: 'M' });
  return result.data;
}

export async function generateQRImage(qrText: string, sessionId: string): Promise<string> {
  ensureQRDir();
  const filePath = path.join(QR_CACHE_DIR, `${sessionId}.bmp`);
  try {
    const matrix = buildMatrix(qrText);
    const buf = matrixToBmp(matrix, 8);
    fs.writeFileSync(filePath, buf);
    return filePath;
  } catch (err) {
    rootLogger.error('QRGenerator: failed to generate QR image', err);
    throw err;
  }
}

export async function generateQRBuffer(qrText: string): Promise<Buffer> {
  try {
    const matrix = buildMatrix(qrText);
    return matrixToBmp(matrix, 8);
  } catch (err) {
    rootLogger.error('QRGenerator: failed to generate QR buffer', err);
    throw err;
  }
}

export async function generateQRDataURL(qrText: string): Promise<string> {
  const buf = await generateQRBuffer(qrText);
  return `data:image/bmp;base64,${buf.toString('base64')}`;
}

export function deleteQRImage(sessionId: string): void {
  for (const ext of ['bmp', 'png']) {
    const filePath = path.join(QR_CACHE_DIR, `${sessionId}.${ext}`);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }
}
