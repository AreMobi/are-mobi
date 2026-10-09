import crypto from "node:crypto";
import zlib from "node:zlib";

/** Visible text and text-bearing attributes, as clause-sized segments. */
export function segmentsOf(html) {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const attrs = [];
  for (const m of h.matchAll(/\b(?:alt|title|aria-label)="([^"]*)"/gi)) attrs.push(m[1]);
  for (const m of h.matchAll(/<meta\s+(?:name|property)="(?:description|og:[a-z]+)"\s+content="([^"]*)"/gi)) attrs.push(m[1]);
  h = h.replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<[^>]+>/g, "\n");
  const raw = [...h.split("\n"), ...attrs].join("\n");
  const dec = raw
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'")
    .replace(/[‘’]/g, "'")
    .toLowerCase();
  return dec.split(/[\n.!?|\/·—–“”"]+/).map((s) => s.trim()).filter(Boolean);
}

export function stringsOfJs(js) {
  const out = [];
  for (const m of js.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) if (/[a-z]{2,}\s+[a-z]{2,}/i.test(m[2])) out.push(m[2].replace(/\$\{[^}]*\}/g, " ").toLowerCase());
  return out;
}

export const wordsOf = (seg) => seg.match(/[a-z0-9']+/g) ?? [];
export const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

export function bigramHashes(segments) {
  const set = new Set();
  for (const seg of segments) {
    const w = wordsOf(seg);
    for (let i = 0; i + 1 < w.length; i++) set.add(hash(w[i] + " " + w[i + 1]));
  }
  return set;
}

/** Minimal PNG reader for 8-bit RGBA (colour type 6). Enough to verify palette pixels. */
export function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0, bd = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  if (bd !== 8 || ct !== 6) throw new Error(`unsupported PNG bd=${bd} ct=${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, ct, bd, px: (x, y) => [...out.subarray(y * stride + x * 4, y * stride + x * 4 + 4)] };
}
