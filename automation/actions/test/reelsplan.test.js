const test = require('node:test');
const assert = require('node:assert');
const { isReelsOnly, carouselUpfront, carouselFallback, fbPhotoNeeded } = require('../lib/reelsplan');
const cfg = require('../config.json');
const on = { igCarouselEnabled: false, reelsEnabled: true, reelsPublishEnabled: true, fbEnabled: true };

test('reels-only skips the upfront carousel', () => {
  assert.equal(isReelsOnly(on), true);
  assert.equal(carouselUpfront(on), false);
});
test('carousel fallback when the Reel fails, none when it publishes', () => {
  assert.equal(carouselFallback(on, false), true);
  assert.equal(carouselFallback(on, true), false);
});
test('carousel runs upfront (no fallback) when igCarouselEnabled is not false', () => {
  for (const c of [{ ...on, igCarouselEnabled: true }, { ...on, igCarouselEnabled: undefined }]) {
    assert.equal(carouselUpfront(c), true);
    assert.equal(carouselFallback(c, false), false);
  }
});
test('reels publishing off means carousel stays on even with igCarouselEnabled false', () => {
  for (const c of [{ ...on, reelsPublishEnabled: false }, { ...on, reelsEnabled: false }]) {
    assert.equal(carouselUpfront(c), true);
    assert.equal(carouselFallback(c, false), false);
  }
});
test('FB photo post only when the FB video failed', () => {
  assert.equal(fbPhotoNeeded(on, true), false);
  assert.equal(fbPhotoNeeded(on, false), true);
  assert.equal(fbPhotoNeeded({ ...on, fbEnabled: false }, false), false);
});
test('live config is Reels-only', () => {
  assert.equal(isReelsOnly(cfg), true);
});
