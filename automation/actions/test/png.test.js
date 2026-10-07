const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertFeedPng, assertStoryPng } = require('../lib/png');

function fakePng(width, height, len) {
  const buf = Buffer.alloc(len);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('feed and story validators require the live n8n dimensions and a real file size', () => {
  assert.doesNotThrow(() => assertFeedPng(fakePng(1080, 1350, 60000)));
  assert.doesNotThrow(() => assertStoryPng(fakePng(1080, 1920, 60000)));
  assert.throws(() => assertFeedPng(fakePng(1080, 1920, 60000)), /Rendered image invalid/);
  assert.throws(() => assertStoryPng(fakePng(1080, 1350, 80000)), /Story image invalid/);
  assert.throws(() => assertFeedPng(fakePng(1080, 1350, 1000)), /Rendered image invalid/);
});
