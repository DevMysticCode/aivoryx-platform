import { describe, expect, it } from 'vitest';
import { ImageValidationError, readImageMeta } from './image-meta.js';

/**
 * Phase 10 (ADR 0039) — logo sniffing. The client MIME type is never trusted:
 * the format and dimensions come from the file's own magic bytes, and only
 * PNG / JPEG / WebP are accepted. Executable-ish types (SVG) and unknown data
 * are rejected.
 */

const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/** A structurally complete PNG: signature + IHDR (with dims) + an IDAT marker
 *  + the IEND trailer. Enough for the header-only `readImageMeta` checks. */
function pngBuffer(width: number, height: number): Buffer {
  const head = Buffer.alloc(24);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.from('....IDAT....', 'ascii'), IEND]);
}

function jpegBuffer(width: number, height: number): Buffer {
  // SOI, then a SOF0 segment carrying the frame dimensions.
  const buf = Buffer.alloc(64);
  buf.set([0xff, 0xd8, 0xff], 0);
  buf[3] = 0xc0; // SOF0 marker
  buf.writeUInt16BE(11, 4); // segment length
  buf[6] = 8; // precision
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  return buf;
}

function webpLossyBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(40);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  buf.writeUInt16LE(width & 0x3fff, 26);
  buf.writeUInt16LE(height & 0x3fff, 28);
  return buf;
}

describe('readImageMeta', () => {
  it('reads PNG dimensions from the IHDR header', () => {
    expect(readImageMeta(pngBuffer(512, 256))).toEqual({
      format: 'image/png',
      width: 512,
      height: 256,
    });
  });

  it('reads JPEG dimensions from the SOF0 frame header', () => {
    expect(readImageMeta(jpegBuffer(300, 120))).toEqual({
      format: 'image/jpeg',
      width: 300,
      height: 120,
    });
  });

  it('reads lossy WebP dimensions', () => {
    expect(readImageMeta(webpLossyBuffer(64, 64))).toEqual({
      format: 'image/webp',
      width: 64,
      height: 64,
    });
  });

  it('rejects an SVG document (executable-capable, not an accepted raster type)', () => {
    const svg = Buffer.from(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    );
    expect(() => readImageMeta(svg)).toThrow(ImageValidationError);
    try {
      readImageMeta(svg);
    } catch (err) {
      expect((err as ImageValidationError).reason).toBe('unsupported_format');
    }
  });

  it('rejects a tiny / truncated file', () => {
    expect(() => readImageMeta(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toThrow(/file_too_small/);
  });

  it('rejects an unknown binary blob', () => {
    expect(() => readImageMeta(Buffer.alloc(64, 0x2a))).toThrow(/unsupported_format/);
  });

  it('does not trust a PNG magic prefix on an unreadable header', () => {
    const buf = Buffer.alloc(32);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // no IHDR marker at offset 12
    expect(() => readImageMeta(buf)).toThrow(/png_header_unreadable/);
  });

  it('rejects a header-only / truncated PNG (valid IHDR but no IDAT/IEND)', () => {
    const buf = Buffer.alloc(32);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    buf.write('IHDR', 12, 'ascii');
    buf.writeUInt32BE(64, 16);
    buf.writeUInt32BE(64, 20);
    expect(() => readImageMeta(buf)).toThrow(/png_no_image_data|png_truncated/);
  });

  it('rejects a PNG whose IEND trailer is missing (truncated body)', () => {
    const noEnd = Buffer.concat([
      pngBuffer(64, 64).subarray(0, 24),
      Buffer.from('....IDAT....some data', 'ascii'),
    ]);
    expect(() => readImageMeta(noEnd)).toThrow(/png_truncated/);
  });
});
