const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(len + 12);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crcData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  chunk.writeUInt32BE(crc32(crcData), len + 8);
  return chunk;
}

function generatePng(size) {
  const width = size;
  const height = size;

  // Raw RGBA scanlines (with filter byte 0 at start of each line)
  const lineSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * lineSize);

  // Background: Rounded rectangle with deep indigo #4F46E5 to violet #9333EA
  // Symbol: Equal bars (SDG 10 Equality) + star dot
  const radius = size * 0.22;
  const center = size / 2;

  for (let y = 0; y < height; y++) {
    const lineOffset = y * lineSize;
    rawData[lineOffset] = 0; // None filter

    for (let x = 0; x < width; x++) {
      const pixelOffset = lineOffset + 1 + x * 4;

      const dx = Math.abs(x - center);
      const dy = Math.abs(y - center);

      const gradT = (x + y) / (width + height);
      let r = Math.round(79 * (1 - gradT) + 147 * gradT);
      let g = Math.round(70 * (1 - gradT) + 51 * gradT);
      let b = Math.round(229 * (1 - gradT) + 234 * gradT);
      let a = 255;

      const cornerD = Math.sqrt(Math.max(0, dx - (center - radius)) ** 2 + Math.max(0, dy - (center - radius)) ** 2);
      if (cornerD > radius) {
        a = 0;
      }

      // Draw Equal bars (Equality symbol = SDG 10)
      const inBarX = x >= size * 0.24 && x <= size * 0.76;
      const inBar1 = inBarX && y >= size * 0.36 && y <= size * 0.46;
      const inBar2 = inBarX && y >= size * 0.54 && y <= size * 0.64;

      // Sparkling star / access dot at top right
      const dotDx = x - size * 0.76;
      const dotDy = y - size * 0.24;
      const inDot = (dotDx * dotDx + dotDy * dotDy) <= (size * 0.08) ** 2;

      if (a > 0 && (inBar1 || inBar2 || inDot)) {
        r = 240;
        g = 253;
        b = 250;
      }

      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idatData = zlib.deflateSync(rawData);

  const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', idatData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngSignature, ihdrChunk, idatChunk, iendChunk]);
}

const outDir = path.resolve(__dirname, '../icons');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const png = generatePng(size);
  const filePath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated icon: ${filePath} (${png.length} bytes)`);
});
