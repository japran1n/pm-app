// Tiny dependency-free PNG encoder for placeholder images (attachments,
// before/after screenshots). Draws a flat background with a few stacked
// "UI blocks" so a thumbnail reads as a mock screenshot, not a blank square.

import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function hex(color: string): [number, number, number] {
  const n = parseInt(color.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export type Block = { x: number; y: number; w: number; h: number; color: string };

export function placeholderPng(width: number, height: number, background: string, blocks: Block[]): Buffer {
  const bg = hex(background);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const parsed = blocks.map((b) => ({ ...b, rgb: hex(b.color) }));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      let rgb = bg;
      for (const b of parsed) {
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) rgb = b.rgb;
      }
      const i = row + 1 + x * 3;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A 640×400 "web page" mock in the given accent colour. */
export function mockScreenshot(accent: string, variant = 0): Buffer {
  const w = 640;
  const h = 400;
  const blocks: Block[] = [
    { x: 0, y: 0, w, h: 36, color: "#1f2933" },
    { x: 24, y: 12, w: 90, h: 12, color: "#f5f5f4" },
    { x: 0, y: 36, w, h: 150, color: accent },
    { x: 40, y: 80, w: 260, h: 22, color: "#ffffff" },
    { x: 40, y: 112, w: 180, h: 12, color: "#e7e5e4" },
    { x: 40, y: 140, w: 110, h: 28, color: "#1f2933" },
  ];
  const cols = variant % 2 === 0 ? 3 : 4;
  const cardW = Math.floor((w - 40 * 2 - (cols - 1) * 16) / cols);
  for (let i = 0; i < cols; i += 1) {
    blocks.push({ x: 40 + i * (cardW + 16), y: 210, w: cardW, h: 120, color: "#e7e5e4" });
    blocks.push({ x: 40 + i * (cardW + 16), y: 338, w: Math.floor(cardW * 0.7), h: 10, color: "#a8a29e" });
  }
  return placeholderPng(w, h, "#fafaf9", blocks);
}
