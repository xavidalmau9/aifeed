const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  hamming, comparePrints, genericFromSignals, urlLooksLikeBrandArt, analyzeBuffer, PHOTO_LIMITS
} = require('../lib/visual');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function jpeg(w, h, paint, quality) {
  const buf = Buffer.alloc(w * h * 3);
  paint(buf, w, h);
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: quality || 85 }).toBuffer();
}

const IMAGES = path.join(__dirname, '../../../images');

test('hamming distance counts differing bits and ignores bad hashes', () => {
  assert.equal(hamming('0000000000000000', '0000000000000000'), 0);
  assert.equal(hamming('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hamming('0000000000000001', '0000000000000000'), 1);
  assert.equal(hamming('nope', '0000000000000000'), 64);
});

test('the same picture survives jpeg recompression and a different picture does not', async () => {
  const logo = (buf, w, h) => {
    for (let i = 0; i < w * h; i++) { buf[i * 3] = 90; buf[i * 3 + 1] = 20; buf[i * 3 + 2] = 160; }
    for (let y = 120; y < 240; y++) for (let x = 220; x < 420; x++) {
      const i = (y * w + x) * 3;
      buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255;
    }
  };
  const a = await analyzeBuffer(await jpeg(640, 360, logo, 90));
  const b = await analyzeBuffer(await jpeg(640, 360, logo, 50));
  const same = comparePrints(a.print, b.print);
  assert.equal(same.near, true);
  assert.ok(same.dhashDist <= PHOTO_LIMITS.dhash);

  const rnd = mulberry32(42);
  const noise = await analyzeBuffer(await jpeg(640, 360, buf => {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rnd() * 256);
  }));
  const different = comparePrints(a.print, noise.print);
  assert.equal(different.near, false);
  assert.ok(different.dhashDist > PHOTO_LIMITS.dhashSoft);
});

test('a flat logo card is generic and a noisy photo is not', async () => {
  const card = await analyzeBuffer(await jpeg(640, 360, (buf, w, h) => {
    for (let i = 0; i < w * h; i++) { buf[i * 3] = 20; buf[i * 3 + 1] = 16; buf[i * 3 + 2] = 40; }
    for (let y = 140; y < 220; y++) for (let x = 250; x < 390; x++) {
      const i = (y * w + x) * 3;
      buf[i] = 240; buf[i + 1] = 240; buf[i + 2] = 245;
    }
  }), { url: 'https://cdn.example.com/brand/mark.jpg' });
  assert.equal(card.generic, true);

  // Large color blocks, not pixel noise: a 48px sample of random pixels averages to gray.
  const photo = await analyzeBuffer(await jpeg(640, 360, (buf, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const band = Math.floor(x / 40);
      buf[i] = (band * 37) % 256;
      buf[i + 1] = (y * 3 + band * 11) % 256;
      buf[i + 2] = (band * 53 + 80) % 256;
      if (x > 200 && x < 280 && y > 80 && y < 260) { buf[i] = 20; buf[i + 1] = 20; buf[i + 2] = 20; }
    }
  }), { url: 'https://cdn.example.com/story/launch.jpg' });
  assert.equal(photo.generic, false);
});

test('stock company-logo filenames are brand art and ordinary photos are not', () => {
  assert.equal(urlLooksLikeBrandArt('https://platform.theverge.com/wp-content/uploads/sites/2/2026/08/STK155_OPEN_AI_CVirginia_C-1.jpg'), true);
  assert.equal(urlLooksLikeBrandArt('https://cdn.example.com/STK269_ANTHROPIC_2_A.jpg'), true);
  assert.equal(urlLooksLikeBrandArt('https://cdn.example.com/STKB364_CLAUDE_2_C.jpg'), true);
  assert.equal(urlLooksLikeBrandArt('https://cdn.example.com/STKS537_AI_MATH_5.jpg'), false);
  assert.equal(urlLooksLikeBrandArt('https://cdn.example.com/openai-logo-on-phone.jpg'), false);
  assert.equal(genericFromSignals({ flatRatio: 0, edgeRatio: 0.36, colors85: 7 }, 'https://cdn.example.com/STK155_OPEN_AI_x.jpg').generic, true);
  assert.equal(genericFromSignals({ flatRatio: 0.47, edgeRatio: 0.11, colors85: 3 }, 'https://cdn.example.com/STK269_ANTHROPIC_2_A.jpg').generic, true);
  assert.equal(genericFromSignals({ flatRatio: 0.53, edgeRatio: 0.14, colors85: 7 }, 'https://media.example.com/story-photo.jpg').generic, false);
  assert.equal(genericFromSignals({ flatRatio: 0.19, edgeRatio: 0.3, colors85: 33 }, 'https://cdn.example.com/portrait.jpg').generic, false);
  assert.equal(genericFromSignals({ flatRatio: 0.83, edgeRatio: 0.02, colors85: 2 }, 'https://cdn.example.com/pic.jpg').generic, true);
});

test('the two OpenAI knot cards match and a different post does not', async () => {
  const read = name => fs.readFileSync(path.join(IMAGES, name));
  const fire = await analyzeBuffer(read('aifeed_openai-doubles-down-on-decision-to_20261009_am.png'), { fromGraphic: true });
  const usa = await analyzeBuffer(read('aifeed_usa-today-becomes-the-latest-publisher_20261009_pm.png'), { fromGraphic: true });
  const anth = await analyzeBuffer(read('aifeed_anthropics-ai-gave-philadelphia-police-fake_20261010_am.png'), { fromGraphic: true });
  const msft = await analyzeBuffer(read('aifeed_microsoft-is-giving-copilot-more-control_20261008_am.png'), { fromGraphic: true });
  const math = await analyzeBuffer(read('aifeed_openai-drops-another-batch-of-mathematical_20261007_pm.png'), { fromGraphic: true });
  const goog = await analyzeBuffer(read('aifeed_google-cloud-announces-gemini-agent-as_20261008_pm.png'), { fromGraphic: true });
  assert.equal(comparePrints(fire.print, usa.print).near, true);
  assert.equal(comparePrints(fire.print, msft.print).near, false);
  assert.equal(comparePrints(fire.print, anth.print).near, false);
  assert.equal(comparePrints(usa.print, math.print).near, false);
  assert.equal(anth.generic, true);
  assert.equal(msft.generic, false);
  assert.equal(math.generic, false);
  assert.equal(goog.generic, false);
  assert.equal(fire.generic, false);
});
