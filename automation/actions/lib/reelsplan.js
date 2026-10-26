// Pure decisions for the Reels-only feed (unit-tested in test/reelsplan.test.js).
function isReelsOnly(cfg) {
  return cfg.igCarouselEnabled === false && Boolean(cfg.reelsEnabled) && Boolean(cfg.reelsPublishEnabled);
}
// Carousel runs up front unless Reels-only; in Reels-only it runs only as fallback when the Reel did not publish.
function carouselUpfront(cfg) { return !isReelsOnly(cfg); }
function carouselFallback(cfg, reelPublished) { return isReelsOnly(cfg) && !reelPublished; }
// FB photo post only when FB is on and the Reel video was not posted to the Page.
function fbPhotoNeeded(cfg, fbVideoDone) { return Boolean(cfg.fbEnabled) && !fbVideoDone; }
// THE one switch for the v3 Reel template: config reelTemplate "v3" (env AIFEED_REEL_TEMPLATE overrides it, for test
// workflows). The result feeds both the brief (reelbrief.js { v3 }) and the renderer (passed explicitly to make_reel.py
// as AIFEED_REEL_TEMPLATE), so the two can never disagree. Anything else = the current v2 Reel.
function reelTemplateOpts(cfg = {}, env = {}) {
  const raw = env.AIFEED_REEL_TEMPLATE != null && String(env.AIFEED_REEL_TEMPLATE).trim() !== '' ? env.AIFEED_REEL_TEMPLATE : cfg.reelTemplate;
  const v3 = String(raw || '').trim().toLowerCase() === 'v3';
  const hs = String(env.AIFEED_HOOK_STYLE || cfg.reelHookStyle || '').trim().toUpperCase();
  return v3 ? { template: 'v3', hookStyle: hs } : { template: 'v2', hookStyle: '' };
}
module.exports = { isReelsOnly, carouselUpfront, carouselFallback, fbPhotoNeeded, reelTemplateOpts };
