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
  const stdout = execFileSync('python3', args, { stdio: ['ignore', 'pipe', 'inherit'], timeout: 600000, encoding: 'utf8', env: sceneEnv(opts) });
  return parseRenderResult(stdout, out);
}

function parseRenderResult(stdout, out) {
  const line = String(stdout || '').trim().split('\n').filter(l => l.trim().startsWith('{')).pop();
  let r = {};
  try { r = line ? JSON.parse(line) : {}; } catch (e) { r = {}; }
  const cover = r.cover || out.replace(/\.mp4$/, '_cover.jpg');
  return { mp4: r.out || out, cover: fs.existsSync(cover) ? cover : '', credit: r.photoCredit || '',
    punch: r.punch || '', sceneSource: r.sceneSource || '', sceneLog: r.sceneLog || [] };
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

async function publishIgReel(cfg, env, { graphForm, pollContainer }, videoUrl, caption, coverUrl) {
  const auth = { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
  const base = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.igUserId}`;
  const fields = { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true' };
  if (coverUrl) fields.cover_url = coverUrl; // our designed cover becomes the grid/feed thumbnail instead of a random frame
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

module.exports = { renderReel, sceneEnv, parseRenderResult, withPhotoCredit, publishIgReel, publishFbVideo };
