// Reels: render a 1080x1920 MP4 per story (automation/reels/make_reel.py, ffmpeg + Pillow, free) and publish
// to IG Reels + FB Page video via the Graph API. Gated by cfg.reelsEnabled (render+commit) and
// cfg.reelsPublishEnabled (post). Failures only alert; the carousel/Story/FB/LinkedIn flow is unaffected.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Env for make_reel.py. Cloudflare's free 10k neurons/day are shared by every render, so only the live post turns it
// on (opts.cloudflare === true); dry runs, samples and tests render with it off and use the free fallback chain.
function sceneEnv(opts = {}, base = process.env) {
  const env = Object.assign({}, base, { AIFEED_SCENE_CF: opts.cloudflare === true ? 'on' : 'off' });
  if (opts.sceneCache) env.AIFEED_SCENE_CACHE = opts.sceneCache;
  // v3 Reel template + hook A/B test (opt-in config keys reelTemplate / reelHookStyle; unset = current v2 Reel)
  // always explicit (never inherited from the job env), so the renderer uses exactly the template the brief was written for
  env.AIFEED_REEL_TEMPLATE = String(opts.template || '').toLowerCase() === 'v3' ? 'v3' : 'v2';
  if (env.AIFEED_REEL_TEMPLATE === 'v3' && opts.hookStyle) env.AIFEED_HOOK_STYLE = String(opts.hookStyle);
  else delete env.AIFEED_HOOK_STYLE;
  return env;
}

// Returns { mp4, cover, credit, punch, sceneSource, sceneLog }. photo = the story's own photo (path or URL).
function renderReel(repo, post, feedPngPath, photo, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-'));
  const postJson = path.join(tmp, 'post.json');
  fs.writeFileSync(postJson, JSON.stringify(post));
  const out = path.join(tmp, post.slug + '.mp4');
  const args = [path.join(repo, 'automation/reels/make_reel.py'), '--post', postJson, '--image', feedPngPath, '--out', out];
  if (photo) args.push('--photo', String(photo));
  if (opts.scene && fs.existsSync(opts.scene)) args.push('--scene', opts.scene, '--scene-source', opts.sceneSource || 'shared', '--scene-credit', opts.sceneCredit || '');
  const stdout = execFileSync('python3', args, { stdio: ['ignore', 'pipe', 'inherit'], timeout: 600000, encoding: 'utf8', env: sceneEnv(opts) });
  return parseRenderResult(stdout, out);
}

// The Reel with the v3 template, and if that fails for ANY reason (crash, timeout, missing mp4) the same Reel again with the
// current v2 template, so a v3 problem never costs the slot (or drops a Reels-only feed to a carousel). v2 runs as before.
// Returns renderReel's result plus { template: 'v3' | 'v2', v3Error }.
function renderReelSafe(repo, post, feedPngPath, photo, opts = {}, deps = {}) {
  const render = deps.render || renderReel, log = deps.log || console.log;
  const ok = rr => { if (!rr || !rr.mp4 || !fs.existsSync(rr.mp4) || !fs.statSync(rr.mp4).size) throw new Error('v3 render produced no mp4'); return rr; };
  if (String(opts.template || '').toLowerCase() === 'v3') {
    try {
      return Object.assign(ok(render(repo, post, feedPngPath, photo, opts)), { template: 'v3', v3Error: '' });
    } catch (e) {
      const why = String((e && e.message) || e).slice(0, 300);
      log('Reel v3 render failed, retrying with the v2 Reel template: ' + why);
      try {
        return Object.assign(render(repo, post, feedPngPath, photo, Object.assign({}, opts, { template: 'v2', hookStyle: '' })), { template: 'v2', v3Error: why });
      } catch (e2) {
        const err = new Error('v3: ' + why + ' | v2: ' + String((e2 && e2.message) || e2).slice(0, 300));
        err.templatesFailed = ['v3', 'v2'];
        throw err;
      }
    }
  }
  try {
    return Object.assign(render(repo, post, feedPngPath, photo, Object.assign({}, opts, { template: 'v2', hookStyle: '' })), { template: 'v2', v3Error: '' });
  } catch (e) {
    if (e && typeof e === 'object') e.templatesFailed = ['v2'];
    throw e;
  }
}

// Carousel slides (4:5) + Story (9:16) in the Reel design (automation/reels/make_slides.py). Picks the scene once and
// saves it; pass the result's scene/sceneSource/credit to renderReel (opts.scene) so the Reel reuses the same image.
// Returns { slides: [png paths], story, scene, sceneSource, sceneLog, credit, punch, points }.
function renderSlides(repo, post, feedPngPath, photo, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-'));
  const postJson = path.join(tmp, 'post.json');
  fs.writeFileSync(postJson, JSON.stringify(post));
  const args = [path.join(repo, 'automation/reels/make_slides.py'), '--post', postJson, '--image', feedPngPath, '--out-dir', tmp];
  if (photo) args.push('--photo', String(photo));
  const stdout = execFileSync('python3', args, { stdio: ['ignore', 'pipe', 'inherit'], timeout: 600000, encoding: 'utf8', env: sceneEnv(opts) });
  const line = String(stdout || '').trim().split('\n').filter(l => l.trim().startsWith('{')).pop();
  const r = JSON.parse(line);
  if (!Array.isArray(r.slides) || r.slides.length < 2 || !r.slides.every(p => fs.existsSync(p)) || !fs.existsSync(r.story)) {
    throw new Error('make_slides returned no slides');
  }
  return r;
}

function parseRenderResult(stdout, out) {
  const line = String(stdout || '').trim().split('\n').filter(l => l.trim().startsWith('{')).pop();
  let r = {};
  try { r = line ? JSON.parse(line) : {}; } catch (e) { r = {}; }
  const cover = r.cover || out.replace(/\.mp4$/, '_cover.jpg');
  return { mp4: r.out || out, cover: fs.existsSync(cover) ? cover : '', credit: r.photoCredit || '',
    punch: r.punch || '', sceneSource: r.sceneSource || '', sceneLog: r.sceneLog || [], voice: r.voice || '', voiceError: r.voiceError || '' };
}

// CC BY / BY-SA photos need attribution: append the Commons credit (without the long URL) once, before the hashtags.
function withPhotoCredit(caption, credit) {
  const c = String(credit || '').replace(/\s*\(https?:\/\/\S+\)\s*$/, '').trim();
  if (!c || String(caption).includes(c)) return caption;
  const lines = String(caption).split('\n');
  let i = lines.length;
  while (i > 0 && /^\s*(#\S+\s*)+$/.test(lines[i - 1])) i--;
  if (i === lines.length) return caption.replace(/\s+$/, '') + '\n\n' + c;
  const head = lines.slice(0, i).join('\n').replace(/\s+$/, '');
  return head + '\n\n' + c + '\n\n' + lines.slice(i).join('\n');
}

// IG Reels container fields. reelsShareToFeed false = Reels tab only (not in the feed grid); default true.
function reelFields(cfg, videoUrl, caption, coverUrl) {
  const fields = { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: cfg.reelsShareToFeed === false ? 'false' : 'true' };
  if (coverUrl) fields.cover_url = coverUrl; // our designed cover becomes the Reel thumbnail instead of a random frame
  return fields;
}

async function publishIgReel(cfg, env, { graphForm, pollContainer }, videoUrl, caption, coverUrl) {
  const auth = { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
  const base = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.igUserId}`;
  const fields = reelFields(cfg, videoUrl, caption, coverUrl);
  const c = await graphForm(base + '/media', fields,
    Object.assign({ tries: 3, waitMs: 15000 }, auth));
  if (!c.id) throw new Error('Instagram did not return a Reel container id');
  await pollContainer(cfg, env, c.id, { waitMs: 15000, maxAttempts: 20, label: 'IG reel' });
  const p = await graphForm(base + '/media_publish', { creation_id: c.id }, Object.assign({ tries: 3, waitMs: 20000 }, auth));
  return p;
}

async function publishFbVideo(cfg, env, { graphForm }, videoUrl, message, title) {
  const auth = { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
  const base = `https://graph-video.facebook.com/${cfg.graphVersion}/${cfg.fbPageId}`;
  return graphForm(base + '/videos', { file_url: videoUrl, description: message, title: String(title || '').slice(0, 250) },
    Object.assign({ tries: 2, waitMs: 10000 }, auth));
}

module.exports = { reelFields, renderReel, renderReelSafe, renderSlides, sceneEnv, parseRenderResult, withPhotoCredit, publishIgReel, publishFbVideo };
