/**
 * Minimal, dependency-free image sniffing for logo uploads (Phase 10, ADR 0039).
 *
 * The client-declared MIME type is NOT trusted — the format is derived from the
 * file's magic bytes, and only PNG / JPEG / WebP are accepted (no SVG: it can
 * carry script; no GIF/BMP/etc.). Dimensions are read from the file header so
 * an absurd image can be rejected without decoding it. This is validation, not
 * a conversion pipeline.
 */

export type LogoFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageMeta {
  format: LogoFormat;
  width: number;
  height: number;
}

export class ImageValidationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ImageValidationError';
  }
}

function readPng(buf: Buffer): ImageMeta {
  // signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4)
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new ImageValidationError('png_header_unreadable');
  }
  return { format: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readJpeg(buf: Buffer): ImageMeta {
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1]!;
    // SOF0..SOF15 (except 0xC4 DHT, 0xC8 JPG, 0xCC DAC) carry frame dimensions
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { format: 'image/jpeg', width, height };
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (segmentLength < 2) throw new ImageValidationError('jpeg_header_unreadable');
    offset += 2 + segmentLength;
  }
  throw new ImageValidationError('jpeg_header_unreadable');
}

function readWebp(buf: Buffer): ImageMeta {
  // "RIFF"...."WEBP" then a chunk: VP8 (lossy) | VP8L (lossless) | VP8X (extended)
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    // 3-byte start code, then 16-bit LE width & height (14 low bits)
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { format: 'image/webp', width, height };
  }
  if (chunk === 'VP8L') {
    const b = buf.subarray(21, 25);
    const bits = b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24);
    return {
      format: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X') {
    // 24-bit LE (width-1) at 24, (height-1) at 27
    const width = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
    const height = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
    return { format: 'image/webp', width, height };
  }
  throw new ImageValidationError('webp_header_unreadable');
}

/** Sniff format + dimensions from the header. Throws `ImageValidationError`. */
export function readImageMeta(buf: Buffer): ImageMeta {
  if (buf.length < 24) throw new ImageValidationError('file_too_small');
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return readPng(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return readJpeg(buf);
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return readWebp(buf);
  }
  throw new ImageValidationError('unsupported_format');
}
