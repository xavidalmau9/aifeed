// Reels: render a 1080x1920 MP4 per story (automation/reels/make_reel.py, ffmpeg + Pillow, free) and publish
// to IG Reels + FB Page video via the Graph API. Gated by cfg.reelsEnabled (render+commit) and
// cfg.reelsPublishEnabled (post). Failures only alert; the carousel/Story/FB/LinkedIn flow is unaffected.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function renderReel(repo, post, feedPngPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-'));
  const postJson = path.join(tmp, 'post.json');
  fs.writeFileSync(postJson, JSON.stringify(post));
  const out = path.join(tmp, post.slug + '.mp4');
  execFileSync('python3', [path.join(repo, 'automation/reels/make_reel.py'), '--post', postJson, '--image', feedPngPath, '--out', out],
    { stdio: 'inherit', timeout: 300000 });
  return out;
}

async function publishIgReel(cfg, env, { graphForm, pollContainer }, videoUrl, caption) {
  const auth = { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
  const base = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.igUserId}`;
  const c = await graphForm(base + '/media', { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true' },
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

module.exports = { renderReel, publishIgReel, publishFbVideo };
