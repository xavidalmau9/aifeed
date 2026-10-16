// Pure decisions for the Reels-only feed (unit-tested in test/reelsplan.test.js).
function isReelsOnly(cfg) {
  return cfg.igCarouselEnabled === false && Boolean(cfg.reelsEnabled) && Boolean(cfg.reelsPublishEnabled);
}
// Carousel runs up front unless Reels-only; in Reels-only it runs only as fallback when the Reel did not publish.
function carouselUpfront(cfg) { return !isReelsOnly(cfg); }
function carouselFallback(cfg, reelPublished) { return isReelsOnly(cfg) && !reelPublished; }
// FB photo post only when FB is on and the Reel video was not posted to the Page.
function fbPhotoNeeded(cfg, fbVideoDone) { return Boolean(cfg.fbEnabled) && !fbVideoDone; }
module.exports = { isReelsOnly, carouselUpfront, carouselFallback, fbPhotoNeeded };
