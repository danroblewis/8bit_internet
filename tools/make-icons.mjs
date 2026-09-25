// Renders the pixel-art toolbar icon at 16/32/48/128 px (no dependencies).
import zlib from 'node:zlib';
import fs from 'node:fs';
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// 16x16 master sprite: invader on a dark rounded tile with a neon frame
const A = {
  '.': [0, 0, 0, 0], 'K': [13, 5, 33, 255], 'F': [255, 43, 214, 255], 'P': [255, 43, 214, 255],
  'Y': [255, 230, 0, 255], 'C': [34, 241, 255, 255], 'D': [122, 44, 255, 255],
};
const art = [
  '.FFFFFFFFFFFFFF.',
  'FKKKKKKKKKKKKKKF',
  'FKKCKKKKKKKKKKKF',
  'FKKKKYKKKKKYKKKF',
  'FKKKKKYKKKYKKKKF',
  'FKKKKYYYYYYYKKKF',
  'FKKKYYKYYYKYYKKF',
  'FKKYYYYYYYYYYYKF',
  'FKKYKYYYYYYYKYKF',
  'FKKYKYKKKKKYKYKF',
  'FKKKKKYYKYYKKKKF',
  'FKKKKKKKKKKKKCKF',
  'FKDKKKKKKKKKKKKF',
  'FKKKKKKKCKKKKKKF',
  'FKKKKKKKKKKKKKKF',
  '.FFFFFFFFFFFFFF.',
];
fs.mkdirSync('extension/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const px = Buffer.alloc(size * size * 4);
  const sc = size / 16;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = A[art[Math.floor(y / sc)][Math.floor(x / sc)]];
    px.set(c, (y * size + x) * 4);
  }
  fs.writeFileSync(`extension/icons/icon${size}.png`, png(size, size, px));
}
console.log('icons written');
