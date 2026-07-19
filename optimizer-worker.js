/* SLO — Image Optimizer Worker
 * Decodes, resizes and re-encodes images entirely off the main thread.
 *
 * PNG output uses a custom indexed-PNG encoder (median-cut quantization +
 * native CompressionStream deflate) because the canvas encoder always writes
 * unoptimized 32-bit RGBA PNGs, often LARGER than the source.
 *
 * Safety net for all formats: if output ≥ original with same format and no
 * resize, the original file is returned untouched (kept: true).
 *
 * Messages in:  { id, file, options: { format, quality, maxWidth, maxHeight } }
 *               { type: 'probe' }  → replies with supported encode formats
 * Messages out: { id, ok, blob, width, height, originalSize, outputSize, ms, kept }
 *               { id, ok: false, error }
 */

const PROBE_FORMATS = ['image/webp', 'image/jpeg', 'image/png', 'image/avif'];

async function probeSupport() {
  const canvas = new OffscreenCanvas(2, 2);
  canvas.getContext('2d').fillRect(0, 0, 2, 2);
  const supported = [];
  for (const type of PROBE_FORMATS) {
    try {
      const blob = await canvas.convertToBlob({ type, quality: 0.8 });
      if (blob && blob.type === type) supported.push(type);
    } catch (_) { /* unsupported */ }
  }
  return supported;
}

function targetDimensions(w, h, maxW, maxH) {
  if ((!maxW || w <= maxW) && (!maxH || h <= maxH)) return { w, h, resized: false };
  const scale = Math.min(maxW ? maxW / w : 1, maxH ? maxH / h : 1);
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
    resized: true,
  };
}

/* ===================== PNG: quantization + indexed encoder ===================== */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlibDeflate(bytes) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* Median-cut quantization over unique RGBA colors. */
function buildPalette(colorCounts, maxColors) {
  const entries = [];
  for (const [key, count] of colorCounts) {
    entries.push({
      r: key & 0xff, g: (key >>> 8) & 0xff, b: (key >>> 16) & 0xff, a: (key >>> 24) & 0xff,
      count,
    });
  }
  if (entries.length <= maxColors) return entries; // lossless indexed

  const CH = ['r', 'g', 'b', 'a'];
  const range = (box, ch) => {
    let min = 255, max = 0;
    for (const e of box) { if (e[ch] < min) min = e[ch]; if (e[ch] > max) max = e[ch]; }
    return max - min;
  };

  let boxes = [entries];
  while (boxes.length < maxColors) {
    let bestBox = -1, bestScore = -1, bestCh = 'r';
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      for (const ch of CH) {
        const s = range(boxes[i], ch);
        if (s > bestScore) { bestScore = s; bestBox = i; bestCh = ch; }
      }
    }
    if (bestBox === -1 || bestScore === 0) break;
    const box = boxes[bestBox];
    box.sort((x, y) => x[bestCh] - y[bestCh]);
    const total = box.reduce((s, e) => s + e.count, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].count;
      if (acc >= total / 2) { cut = i + 1; break; }
    }
    boxes.splice(bestBox, 1, box.slice(0, cut), box.slice(cut));
  }

  return boxes.map((box) => {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (const e of box) { r += e.r * e.count; g += e.g * e.count; b += e.b * e.count; a += e.a * e.count; n += e.count; }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: Math.round(a / n), count: n };
  });
}

/* Encode ImageData as an indexed (palette) PNG. Returns null if >256 colors
 * would be needed and lossless was requested, or if unsupported. */
async function encodeIndexedPNG(imageData, maxColors) {
  if (typeof CompressionStream === 'undefined') return null;
  const { data, width: w, height: h } = imageData;
  const px = new Uint32Array(data.buffer, data.byteOffset, w * h);

  // Count unique colors
  const colorCounts = new Map();
  for (let i = 0; i < px.length; i++) {
    colorCounts.set(px[i], (colorCounts.get(px[i]) || 0) + 1);
  }
  if (colorCounts.size > maxColors && maxColors >= 256) return null; // lossless requested, can't index

  const palette = buildPalette(colorCounts, Math.min(maxColors, 256));

  // Sort: opaque entries last so tRNS can be truncated
  palette.sort((a, b) => a.a - b.a);

  // Map every unique color to its nearest palette index
  const lookup = new Map();
  for (const key of colorCounts.keys()) {
    const r = key & 0xff, g = (key >>> 8) & 0xff, b = (key >>> 16) & 0xff, a = (key >>> 24) & 0xff;
    let best = 0, bestD = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const e = palette[p];
      const d = (r - e.r) ** 2 + (g - e.g) ** 2 + (b - e.b) ** 2 + (a - e.a) ** 2;
      if (d < bestD) { bestD = d; best = p; if (d === 0) break; }
    }
    lookup.set(key, best);
  }

  // Raw scanlines: 1 filter byte (0 = None) + indices
  const raw = new Uint8Array(h * (w + 1));
  let o = 0, i = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) raw[o++] = lookup.get(px[i++]);
  }

  const idat = await zlibDeflate(raw);

  // IHDR
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 3;  // color type: indexed
  // compression / filter / interlace = 0

  // PLTE + tRNS
  const plte = new Uint8Array(palette.length * 3);
  let alphaLen = 0;
  for (let p = 0; p < palette.length; p++) {
    plte[p * 3] = palette[p].r; plte[p * 3 + 1] = palette[p].g; plte[p * 3 + 2] = palette[p].b;
    if (palette[p].a !== 255) alphaLen = p + 1;
  }
  const trns = new Uint8Array(alphaLen);
  for (let p = 0; p < alphaLen; p++) trns[p] = palette[p].a;

  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('PLTE', plte),
  ];
  if (alphaLen) parts.push(pngChunk('tRNS', trns));
  parts.push(pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0)));

  return new Blob(parts, { type: 'image/png' });
}

/* ===================== Main pipeline ===================== */

async function optimize(file, options) {
  const t0 = performance.now();
  const { format = 'image/webp', quality = 0.8, maxWidth = 0, maxHeight = 0 } = options;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new Error('DECODE:' + (err && err.message ? err.message : 'formato não suportado'));
  }

  const { w, h, resized } = targetDimensions(bitmap.width, bitmap.height, maxWidth, maxHeight);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // JPEG has no alpha — flatten onto white so transparency doesn't turn black.
  if (format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let blob = null;

  if (format === 'image/png') {
    // quality 100% → lossless (indexed only if ≤256 unique colors);
    // below that → quantize to a palette sized by the quality slider.
    const maxColors = quality >= 1 ? 256 : Math.max(8, Math.round(quality * 256));
    try {
      blob = await encodeIndexedPNG(ctx.getImageData(0, 0, w, h), maxColors);
    } catch (_) { blob = null; }
  }

  if (!blob) {
    blob = await canvas.convertToBlob(
      format === 'image/png' ? { type: format } : { type: format, quality }
    );
  }

  // Never ship a "bigger" file: same format + no resize → keep the original.
  let kept = false;
  if (!resized && blob.size >= file.size && file.type === format) {
    blob = file;
    kept = true;
  }

  return {
    blob,
    width: w,
    height: h,
    originalSize: file.size,
    outputSize: blob.size,
    ms: Math.round(performance.now() - t0),
    kept,
  };
}

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'probe') {
    self.postMessage({ type: 'probe', supported: await probeSupport() });
    return;
  }

  const { id, file, options } = msg;
  try {
    const result = await optimize(file, options);
    self.postMessage({ id, ok: true, ...result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
