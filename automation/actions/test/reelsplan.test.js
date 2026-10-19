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
test('live config: carousel is the feed post, Reel goes to the Reels tab only', () => {
  assert.equal(isReelsOnly(cfg), false);
  assert.equal(carouselUpfront(cfg), true);
  assert.equal(carouselFallback(cfg, false), false); // a failed Reel only alerts, no second carousel
  assert.equal(cfg.reelsShareToFeed, false);
  assert.equal(fbPhotoNeeded(cfg, true), false); // FB stays video-only when the video posts
  assert.equal(fbPhotoNeeded(cfg, false), true); // FB photo post only if the FB video failed
});

const { reelFields } = require('../lib/reels');
test('reelFields: share_to_feed follows reelsShareToFeed (default true), cover_url only when set', () => {
  assert.equal(reelFields({ reelsShareToFeed: false }, 'v.mp4', 'c', 'cov.jpg').share_to_feed, 'false');
  assert.equal(reelFields({ reelsShareToFeed: true }, 'v.mp4', 'c', '').share_to_feed, 'true');
  assert.equal(reelFields({}, 'v.mp4', 'c', '').share_to_feed, 'true');
  const f = reelFields(cfg, 'https://aifeed.run/videos/reels/x.mp4', 'cap', 'https://aifeed.run/videos/reels/x_cover.jpg');
  assert.deepEqual(f, { media_type: 'REELS', video_url: 'https://aifeed.run/videos/reels/x.mp4', caption: 'cap', share_to_feed: 'false', cover_url: 'https://aifeed.run/videos/reels/x_cover.jpg' });
  assert.equal('cover_url' in reelFields(cfg, 'v', 'c', ''), false);
});
