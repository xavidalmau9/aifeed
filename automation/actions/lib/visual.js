// Perceptual fingerprints for story photos, and a local check for generic brand art.
// The feed card covers the lower half of the picture with the headline, so hashes use the
// upper band a reader actually sees. Same artwork (the OpenAI knot used on two posts) matches;
// a portrait or a product screenshot does not.
const sharp = require('sharp');

const PHOTO_LIMITS = {
  recent: 14,
  dhash: 12,
  phash: 10,
  dhashSoft: 16,
  hist: 0.9
};

// Upper band of the 1080x1350 card, inside the badge and above the headline shade.
const CARD_WINDOW = { top: 0.08, height: 0.36, left: 0.04, width: 0.92 };
const CARD_ASPECT = 1080 / 1350;

function urlLooksLikeBrandArt(url) {
  const u = String(url || '');
  if (/(logo|wordmark|brand[-_]?mark|app[-_]?icon)/i.test(u) && !/(phone|hand|person|portrait|screenshot|photo)/i.test(u)) return true;
  // The Verge reuses STK###_COMPANY illustrations (and STKB###_CLAUDE) for every story about that company.
  if (/STK[A-Z]?\d+_(OPEN_?AI|ANTHROPIC|CLAUDE|CHATGPT|GEMINI|COPILOT|GOOGLE|MICROSOFT|META|NVIDIA|XAI|DEEPMIND)/i.test(u)) return true;
  return false;
}

function hexOf(bits) {
  return bits.toString(16).padStart(16, '0');
}

function hamming(a, b) {
  if (!/^[0-9a-f]{16}$/i.test(String(a || '')) || !/^[0-9a-f]{16}$/i.test(String(b || ''))) return 64;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

function grayFromRGB(rgb) {
  const n = rgb.length / 3;
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    g[i] = rgb[i * 3] * 0.299 + rgb[i * 3 + 1] * 0.587 + rgb[i * 3 + 2] * 0.114;
  }
  return g;
}

function dhashFromGray9x8(gray) {
  let bits = 0n;
  let i = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (gray[y * 9 + x] > gray[y * 9 + x + 1]) bits |= 1n << BigInt(i);
      i++;
    }
  }
  return hexOf(bits);
}

// First 8 DCT coefficients. 32x32 is small enough that this stays in the millisecond range.
function dctLow(vec) {
  const N = vec.length;
  const out = new Float64Array(8);
  const factor = Math.PI / (2 * N);
  for (let k = 0; k < 8; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) sum += vec[n] * Math.cos((2 * n + 1) * k * factor);
    out[k] = sum;
  }
  return out;
}

function phashFromGray32(gray) {
  const N = 32;
  const rows = new Array(N);
  for (let y = 0; y < N; y++) rows[y] = dctLow(gray.subarray(y * N, y * N + N));
  const vals = new Float64Array(64);
  let t = 0;
  for (let u = 0; u < 8; u++) {
    const col = new Float64Array(N);
    for (let y = 0; y < N; y++) col[y] = rows[y][u];
    const d = dctLow(col);
    for (let v = 0; v < 8; v++) vals[t++] = d[v];
  }
  const sorted = Array.from(vals).sort((a, b) => a - b);
  const med = (sorted[31] + sorted[32]) / 2;
  let bits = 0n;
  for (let i = 0; i < 64; i++) if (vals[i] > med) bits |= 1n << BigInt(i);
  return hexOf(bits);
}

function colorHist(rgb) {
  const bins = new Array(64).fill(0);
  const n = rgb.length / 3;
  if (!n) return bins;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3] >> 6;
    const g = rgb[i * 3 + 1] >> 6;
    const b = rgb[i * 3 + 2] >> 6;
    bins[(r << 4) | (g << 2) | b]++;
  }
  return bins.map(v => Math.round((v / n) * 1000));
}

function histSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let inter = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    inter += Math.min(a[i], b[i]);
    sa += a[i];
    sb += b[i];
  }
  return inter / Math.max(sa, sb, 1);
}

function comparePrints(a, b, limits) {
  const lim = limits || PHOTO_LIMITS;
  const dhashDist = hamming(a && a.dhash, b && b.dhash);
  const phashDist = hamming(a && a.phash, b && b.phash);
  const hist = histSimilarity(a && a.hist, b && b.hist);
  const near = dhashDist <= lim.dhash
    || phashDist <= lim.phash
    || (dhashDist <= lim.dhashSoft && hist >= lim.hist);
  return { dhashDist, phashDist, hist, near };
}

function logoSignalsFromRGB(rgb, size) {
  const S = size;
  const block = 8;
  const across = Math.floor(S / block);
  let flat = 0;
  for (let by = 0; by < across; by++) {
    for (let bx = 0; bx < across; bx++) {
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const px = ((by * block + y) * S + (bx * block + x)) * 3;
          const l = rgb[px] * 0.299 + rgb[px + 1] * 0.587 + rgb[px + 2] * 0.114;
          sum += l;
          sum2 += l * l;
          n++;
        }
      }
      const mean = sum / n;
      const variance = Math.max(0, sum2 / n - mean * mean);
      if (variance < 220) flat++;
    }
  }
  const blocks = across * across;
  let edge = 0;
  let pixels = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S - 1; x++) {
      const i = (y * S + x) * 3;
      const l1 = rgb[i] * 0.299 + rgb[i + 1] * 0.587 + rgb[i + 2] * 0.114;
      const l2 = rgb[i + 3] * 0.299 + rgb[i + 4] * 0.587 + rgb[i + 5] * 0.114;
      if (Math.abs(l1 - l2) > 26) edge++;
      pixels++;
    }
  }
  const counts = new Map();
  const n = S * S;
  for (let i = 0; i < n; i++) {
    const key = ((rgb[i * 3] >> 5) << 6) | ((rgb[i * 3 + 1] >> 5) << 3) | (rgb[i * 3 + 2] >> 5);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.values()].sort((a, b) => b - a);
  let cover = 0;
  let colors85 = 0;
  for (const c of sorted) {
    cover += c;
    colors85++;
    if (cover / n >= 0.85) break;
  }
  return {
    flatRatio: blocks ? flat / blocks : 0,
    edgeRatio: pixels ? edge / pixels : 0,
    colors85
  };
}

function genericFromSignals(signals, url) {
  const s = signals || { flatRatio: 0, edgeRatio: 1, colors85: 99 };
  const brandUrl = urlLooksLikeBrandArt(url);
  const flatPct = Math.round(s.flatRatio * 100);
  const edgePct = Math.round(s.edgeRatio * 100);
  // Smooth fields with almost no texture: a wordmark or logo on a flat background.
  // A photo of a screen or a person stays under this; those still have edges.
  if (s.flatRatio >= 0.72 && s.edgeRatio <= 0.2) {
    return { generic: true, reason: `flat brand graphic (${flatPct}% smooth, ${s.colors85} main colors)` };
  }
  if (s.colors85 <= 4 && s.edgeRatio <= 0.18 && s.flatRatio >= 0.4) {
    return { generic: true, reason: `logo-like simple palette (${flatPct}% smooth, ${edgePct}% edges, ${s.colors85} colors)` };
  }
  // The Verge's STK###_OPEN_AI / STK###_ANTHROPIC files are reused for every story about
  // that company. They can be geometrically busy, so flatness alone misses the OpenAI knot.
  if (brandUrl && s.colors85 <= 12 && s.edgeRatio <= 0.45) {
    return { generic: true, reason: `reusable company brand art (${s.colors85} colors, stock logo filename)` };
  }
  return { generic: false, reason: '' };
}

// Region of `buffer`'s pixels that `background-size: cover` puts in the card's photo band.
function cardWindowBox(w, h) {
  let left;
  let top;
  let width;
  let height;
  if (Math.abs(w / h - CARD_ASPECT) < 0.05) {
    left = w * CARD_WINDOW.left;
    top = h * CARD_WINDOW.top;
    width = w * CARD_WINDOW.width;
    height = h * CARD_WINDOW.height;
  } else {
    const scale = Math.max(1080 / w, 1350 / h);
    const visW = 1080 / scale;
    const visH = 1350 / scale;
    const visLeft = (w - visW) / 2;
    const visTop = (h - visH) / 2;
    left = visLeft + visW * CARD_WINDOW.left;
    top = visTop + visH * CARD_WINDOW.top;
    width = visW * CARD_WINDOW.width;
    height = visH * CARD_WINDOW.height;
  }
  left = Math.max(0, Math.min(w - 2, Math.round(left)));
  top = Math.max(0, Math.min(h - 2, Math.round(top)));
  width = Math.max(8, Math.min(w - left, Math.round(width)));
  height = Math.max(8, Math.min(h - top, Math.round(height)));
  return { left, top, width, height };
}

async function resizeRGB(buffer, { extract, width, height }) {
  let p = sharp(buffer, { failOn: 'none' }).rotate();
  if (extract) p = p.extract(extract);
  const { data, info } = await p.resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgb: data, width: info.width, height: info.height };
}

async function imageSize(buffer) {
  const meta = await sharp(buffer, { failOn: 'none' }).rotate().metadata();
  return { width: meta.width || 0, height: meta.height || 0 };
}

async function analyzeBuffer(buffer, { fromGraphic = false, url = '' } = {}) {
  const { width, height } = await imageSize(buffer);
  if (!width || !height) throw new Error('undecodable image');
  const extract = cardWindowBox(width, height);
  const view = await resizeRGB(buffer, { extract, width: 32, height: 32 });
  const dview = await resizeRGB(buffer, { extract, width: 9, height: 8 });
  const print = {
    dhash: dhashFromGray9x8(grayFromRGB(dview.rgb)),
    phash: phashFromGray32(grayFromRGB(view.rgb)),
    hist: colorHist(view.rgb)
  };
  // A rendered card's lower half is our own template, so brand-art signals use the photo band.
  // A source photo is judged on the whole frame (the logo card fills it).
  const logoSrc = fromGraphic
    ? await resizeRGB(buffer, { extract, width: 48, height: 48 })
    : await resizeRGB(buffer, { width: 48, height: 48 });
  const signals = logoSignalsFromRGB(logoSrc.rgb, 48);
  const judged = genericFromSignals(signals, url);
  const preview = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 60 })
    .toBuffer();
  return {
    width,
    height,
    print,
    signals,
    generic: judged.generic,
    genericReason: judged.reason,
    preview
  };
}

function nearestPrint(print, recent, limits) {
  let best = null;
  for (const r of recent || []) {
    const fp = r && r.dhash ? r : (r && r.print);
    if (!fp || !fp.dhash) continue;
    const cmp = comparePrints(print, fp, limits);
    const row = {
      headline: r.headline || '',
      image: r.image || '',
      dhashDist: cmp.dhashDist,
      phashDist: cmp.phashDist,
      hist: cmp.hist,
      near: cmp.near
    };
    if (!best || row.dhashDist < best.dhashDist || (row.dhashDist === best.dhashDist && row.phashDist < best.phashDist)) best = row;
  }
  return best || { near: false, dhashDist: 64, phashDist: 64, hist: 0, headline: '', image: '' };
}

module.exports = {
  PHOTO_LIMITS,
  CARD_WINDOW,
  urlLooksLikeBrandArt,
  hamming,
  histSimilarity,
  comparePrints,
  genericFromSignals,
  logoSignalsFromRGB,
  cardWindowBox,
  analyzeBuffer,
  nearestPrint,
  imageSize
};
