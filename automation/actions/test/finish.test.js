const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkIg } = require('../lib/captions');
const { CLAIM_PATH, updateClaimDoc } = require('../lib/claim');
const { readJson, writeJson } = require('../lib/git');
const { assertReelsTools } = require('../lib/tools');
const {
  igCaptionFromPost, photoUrlFromHtml, planFinish, storyImageName
} = require('../lib/finish');
const { runFinish } = require('../finish');

const LIVE = require('../../../_posts/posts-index.json')
  .find(p => p.slug === 'ai-guardrails-arent-stopping-criminal-hackers');
const URL = LIVE.sourceUrl;

test('the published guardrails story builds a legal IG caption', () => {
  const cap = igCaptionFromPost(LIVE);
  assert.deepEqual(checkIg(cap, URL), []);
  assert.match(cap, /^\p{Extended_Pictographic}/u);
  assert.match(cap, /Free weekly AI brief at aifeed\.run/);
  assert.match(cap, /Source: WIRED · https:\/\/www\.wired\.com\/story\/ai-guardrails-arent-stopping-criminal-hackers\//);
  assert.doesNotMatch(cap, /\bdaily\b/i);
  assert.doesNotMatch(cap, /hand[- ]?edited|human[- ]?edited|edited by|our editors|curated by/i);
});

test('a paragraph that claims human editing or says daily is left out of the caption', () => {
  const post = Object.assign({}, LIVE, {
    body: LIVE.body.replace('</p>', '</p><p>This briefing was hand-edited daily by our editors.</p>')
  });
  const cap = igCaptionFromPost(post);
  assert.deepEqual(checkIg(cap, URL), []);
  assert.doesNotMatch(cap, /hand-edited|\bdaily\b|our editors/i);
});

test('banned-only copy is refused', () => {
  const post = {
    sourceUrl: URL,
    summary: 'This was hand-edited daily by our editors.',
    hashtags: LIVE.hashtags,
    body: '<p>Our editors hand-edited this daily.</p><p>Curated by our team daily.</p>'
  };
  assert.throws(() => igCaptionFromPost(post), /not enough clean paragraphs|human editing|daily/);
});

test('og:image keeps the real photo url, including decoded apostrophes', () => {
  const html = '<meta property="og:image" content="https://media.wired.com/photos/6ad7cd65322aff8e01d3ff70/191:100/w_1280,c_limit/Security_Claude&#x27;s_Guardrails.jpg">';
  const url = photoUrlFromHtml(html);
  assert.equal(url, "https://media.wired.com/photos/6ad7cd65322aff8e01d3ff70/191:100/w_1280,c_limit/Security_Claude's_Guardrails.jpg");
  assert.equal(storyImageName('aifeed_ai-guardrails-arent-stopping-criminal-hackers_20261022_pm.png'),
    'aifeed_ai-guardrails-arent-stopping-criminal-hackers_20261022_pm_story.png');
});

test('planFinish posts only the channels that are not already live', () => {
  const sourceUrl = URL;
  const none = planFinish({ sourceUrl, progress: {}, igMedia: [], fbPosts: [], igStories: [], storiesKnown: true });
  assert.equal(none.postReel, true);
  assert.equal(none.postStory, true);
  assert.equal(none.postFb, true);
  assert.equal(none.done, false);

  const ig = planFinish({
    sourceUrl,
    progress: {},
    igMedia: [{ id: 'ig1', media_type: 'VIDEO', media_product_type: 'REELS', caption: 'Story\n\nSource: WIRED · ' + sourceUrl }],
    fbPosts: [{ id: 'fb1', isVideo: true, description: 'Source: WIRED · ' + sourceUrl.replace(/\/$/, '') }],
    igStories: [],
    storiesKnown: true
  });
  assert.equal(ig.postReel, false);
  assert.equal(ig.igReelId, 'ig1');
  assert.equal(ig.postFb, false);
  assert.equal(ig.fbPostId, 'fb1');
  assert.equal(ig.postStory, true);

  const photoOnly = planFinish({
    sourceUrl,
    progress: {},
    igMedia: [
      { id: 'feed1', media_type: 'IMAGE', media_product_type: 'FEED', caption: 'Source: ' + sourceUrl },
      { id: 'car1', media_type: 'CAROUSEL_ALBUM', caption: 'Source: ' + sourceUrl },
      { id: 'vidfeed', media_type: 'VIDEO', media_product_type: 'FEED', caption: 'Source: ' + sourceUrl }
    ],
    fbPosts: [{ id: 'fbphoto', status_type: 'added_photos', message: 'Source: ' + sourceUrl }],
    igStories: [],
    storiesKnown: true
  });
  assert.equal(photoOnly.postReel, true);
  assert.equal(photoOnly.igReelId, '');
  assert.equal(photoOnly.postFb, true);
  assert.equal(photoOnly.fbPostId, '');

  const noProductType = planFinish({
    sourceUrl,
    progress: {},
    igMedia: [{ id: 'v1', media_type: 'VIDEO', caption: 'Source: ' + sourceUrl }],
    fbPosts: [{ id: 'fv1', status_type: 'added_video', message: 'Source: ' + sourceUrl }],
    igStories: [],
    storiesKnown: true
  });
  assert.equal(noProductType.igReelId, 'v1');
  assert.equal(noProductType.fbPostId, 'fv1');

  const morning = planFinish({
    sourceUrl,
    progress: { storyAttemptAt: '2026-10-22T21:59:00.000Z' },
    igMedia: [],
    fbPosts: [],
    igStories: [{ id: 'morning', timestamp: '2026-10-22T12:30:00+0000' }],
    storiesKnown: true
  });
  assert.equal(morning.postStory, true);
  assert.equal(morning.igStoryId, '');

  const adopted = planFinish({
    sourceUrl,
    progress: { storyAttemptAt: '2026-10-22T21:59:00.000Z', igReelId: 'r', fbPostId: 'f' },
    igMedia: [],
    fbPosts: [],
    igStories: [
      { id: 'morning', timestamp: '2026-10-22T12:30:00+0000' },
      { id: 'pm', timestamp: '2026-10-22T22:05:00+0000' }
    ],
    storiesKnown: true
  });
  assert.equal(adopted.postStory, false);
  assert.equal(adopted.igStoryId, 'pm');
  assert.equal(adopted.postReel, false);
  assert.equal(adopted.done, true);

  const blind = planFinish({
    sourceUrl,
    progress: { storyAttemptAt: '2026-10-22T21:59:00.000Z' },
    igMedia: [],
    fbPosts: [],
    igStories: [],
    storiesKnown: false
  });
  assert.match(blind.error, /refusing to post another Story/);
});

test('ffmpeg must answer before a slot can be claimed, and the workflow installs it first', () => {
  assert.throws(() => assertReelsTools(() => { throw new Error('not found'); }), /Refusing to claim a slot/);
  assert.throws(() => assertReelsTools(() => 'busybox'), /did not report ffmpeg/);
  assert.doesNotThrow(() => assertReelsTools(() => 'ffmpeg version 7.0.2-static'));

  const pipeline = fs.readFileSync(path.join(__dirname, '../pipeline.js'), 'utf8');
  const toolsAt = pipeline.indexOf('assertReelsTools()');
  const claimAt = pipeline.indexOf("writeClaim(env, decision, 'claimed'");
  assert.ok(toolsAt > 0 && toolsAt < claimAt);
  assert.ok(pipeline.indexOf('runFinish') < pipeline.indexOf('hasRequest'));
  assert.match(pipeline, /EVENT_NAME !== 'workflow_dispatch'/);

  const yml = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/autopilot.yml'), 'utf8');
  const post = yml.split('\n  post:\n')[1];
  assert.ok(post);
  assert.match(post, /timeout-minutes:\s*75/);
  assert.doesNotMatch(post, /apt-get install -y ffmpeg/);
  assert.match(post, /aifeed-kokoro/);
  assert.match(post, /aifeed-ffmpeg/);
  assert.match(yml, /finish_slug:/);
  assert.match(post, /FINISH_SLUG:/);
  assert.ok(post.indexOf('Install static ffmpeg') < post.indexOf('Verify Reels tools before a slot can be claimed'));
  assert.ok(post.indexOf('Verify Reels tools before a slot can be claimed') < post.indexOf('name: Run autopilot'));

  const sh = fs.readFileSync(path.join(__dirname, '../install-ffmpeg.sh'), 'utf8');
  assert.doesNotMatch(sh, /apt-get\s+install/);
  assert.match(sh, /johnvansickle\.com\/ffmpeg\/releases\/ffmpeg-\$\{VER\}-amd64-static\.tar\.xz/);
  assert.match(sh, /abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67/);

  const finishSrc = fs.readFileSync(path.join(__dirname, '../finish.js'), 'utf8');
  assert.doesNotMatch(finishSrc, /publishInstagram|CAROUSEL/);
  assert.match(finishSrc, /sceneSource: 'story'/);
  assert.match(finishSrc, /cloudflare: false/);
  assert.match(finishSrc, /publishIgReel/);
  assert.match(finishSrc, /media_type: 'STORIES'/);
});

function repoFor(dir) {
  const image = 'aifeed_ai-guardrails-arent-stopping-criminal-hackers_20261022_pm.png';
  fs.mkdirSync(path.join(dir, '_posts'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  writeJson(dir, '_posts/posts-index.json', [LIVE]);
  writeJson(dir, '_data/history.json', {
    posted: [{
      date: '2026-10-22', slot: 2, slug: LIVE.slug, image,
      headline: LIVE.headline, url: URL
    }],
    rankings: {}
  });
  writeJson(dir, CLAIM_PATH, {
    claims: { '2026-10-22:2': { status: 'claimed', at: '2026-10-22T21:49:30.594Z', by: 'github-actions' } }
  });
  fs.writeFileSync(path.join(dir, 'images', image), 'png');
  fs.writeFileSync(path.join(dir, 'images', image.replace(/\.png$/, '_story.png')), 'png');
  return {
    REPO: dir,
    DRY_RUN: false,
    META_PAGE_TOKEN: 'test-token',
    META_APP_SECRET: '',
    FINISH_SLUG: LIVE.slug,
    OUT: path.join(dir, 'out')
  };
}

function fakeIo(graphForm) {
  const renders = [];
  return {
    renders,
    assertTools() {},
    commitApply(repo, message, mutate) { return mutate(); },
    writeClaim(env, decision, status, { extra, takeOver = false } = {}) {
      const doc = readJson(env.REPO, CLAIM_PATH, { claims: {} });
      const next = updateClaimDoc(doc, {
        date: decision.date, slot: decision.slot, status, at: '2026-10-22T23:10:00.000Z',
        by: 'github-actions', extra, takeOver: status === 'claimed' && takeOver
      });
      if (!next.ok) throw new Error(next.reason);
      writeJson(env.REPO, CLAIM_PATH, next.doc);
    },
    graphGet: async url => {
      if (String(url).includes('/stories')) return { data: [] };
      if (String(url).includes('/videos?')) return { data: [] };
      if (String(url).includes('/published_posts')) return { data: [] };
      if (String(url).includes('/media?')) return { data: [] };
      if (String(url).includes('fields=permalink')) return { permalink: 'https://www.instagram.com/reel/EXAMPLE' };
      if (String(url).includes('permalink_url')) return { permalink_url: 'https://www.facebook.com/EXAMPLE/posts/1' };
      return {};
    },
    graphForm,
    pollContainer: async () => {},
    pollPublic: async () => {},
    renderReel(repo, post, feed, photo, opts) {
      renders.push(opts);
      return { mp4: photo, cover: photo, credit: '', sceneSource: 'story', punch: 'GUARDRAILS / *FAIL', voice: 'kokoro:am_michael@1.05' };
    },
    fetchText: async () => '<meta property="og:image" content="https://media.wired.com/photos/6ad7cd65322aff8e01d3ff70/real.jpg">',
    downloadPhoto: async (url, dest) => {
      const buf = Buffer.alloc(9000, 0);
      buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
      fs.writeFileSync(dest, buf);
      assert.match(url, /^https:\/\/media\.wired\.com\//);
      return dest;
    }
  };
}

test('finish posts Reel, Story and Facebook once, then a rerun does not post again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-ok-'));
  const env = repoFor(dir);
  const calls = [];
  const graphForm = async (url, fields) => {
    calls.push({ url: String(url), fields });
    if (String(url).includes('/media_publish')) return { id: fields.creation_id + '-pub' };
    if (fields && fields.media_type === 'REELS') return { id: 'reel-container' };
    if (fields && fields.media_type === 'STORIES') return { id: 'story-container' };
    if (String(url).includes('/videos')) return { id: 'fb-video-1' };
    throw new Error('unexpected graph call ' + url);
  };
  const io = fakeIo(graphForm);
  const cfg = require('../config.json');
  await runFinish(cfg, env, io);
  assert.equal(io.renders.length, 1);
  assert.equal(io.renders[0].cloudflare, false);
  assert.equal(io.renders[0].sceneSource, 'story');
  assert.match(io.renders[0].scene, /photo\.jpg$/);
  const reels = calls.filter(c => c.fields && c.fields.media_type === 'REELS');
  const stories = calls.filter(c => c.fields && c.fields.media_type === 'STORIES');
  const videos = calls.filter(c => c.url.includes('/videos'));
  assert.equal(reels.length, 1);
  assert.equal(reels[0].fields.share_to_feed, 'false');
  assert.match(reels[0].fields.cover_url, /_cover\.jpg$/);
  assert.match(reels[0].fields.caption, /Free weekly AI brief/);
  assert.doesNotMatch(reels[0].fields.caption, /\bdaily\b/i);
  assert.equal(stories.length, 1);
  assert.equal(videos.length, 1);
  assert.equal(calls.some(c => c.fields && c.fields.media_type === 'CAROUSEL'), false);
  const claim = readJson(dir, CLAIM_PATH, {});
  assert.equal(claim.claims['2026-10-22:2'].status, 'posted');
  assert.equal(claim.claims['2026-10-22:2'].slug, LIVE.slug);
  assert.equal(claim.claims['2026-10-22:2'].igReelId, 'reel-container-pub');
  assert.equal(claim.claims['2026-10-22:2'].igStoryId, 'story-container-pub');
  assert.equal(claim.claims['2026-10-22:2'].fbPostId, 'fb-video-1');

  const before = calls.length;
  await runFinish(cfg, env, io);
  assert.equal(calls.length, before);
  assert.equal(io.renders.length, 1);
});

test('a Story failure does not mark the slot posted and a retry does not repost the Reel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-story-'));
  const env = repoFor(dir);
  let stories = 0;
  const calls = [];
  const graphForm = async (url, fields) => {
    calls.push({ url: String(url), fields });
    if (fields && fields.media_type === 'STORIES') {
      stories += 1;
      if (stories === 1) throw new Error('story down');
      return { id: 'story-container' };
    }
    if (String(url).includes('/media_publish')) return { id: fields.creation_id + '-pub' };
    if (fields && fields.media_type === 'REELS') return { id: 'reel-container' };
    if (String(url).includes('/videos')) return { id: 'fb-video-9' };
    throw new Error('unexpected graph call ' + url);
  };
  const io = fakeIo(graphForm);
  const cfg = require('../config.json');
  await assert.rejects(() => runFinish(cfg, env, io), /story down|Finish incomplete|Instagram did not return a story/);
  assert.equal(readJson(dir, CLAIM_PATH, {}).claims['2026-10-22:2'].status, 'claimed');
  const progress = readJson(dir, '_data/finish-progress.json', {});
  assert.equal(progress[LIVE.slug].igReelId, 'reel-container-pub');
  assert.ok(progress[LIVE.slug].storyAttemptAt);
  assert.equal(calls.filter(c => c.fields && c.fields.media_type === 'REELS').length, 1);

  await runFinish(cfg, env, io);
  assert.equal(calls.filter(c => c.fields && c.fields.media_type === 'REELS').length, 1);
  assert.equal(readJson(dir, CLAIM_PATH, {}).claims['2026-10-22:2'].status, 'posted');
  assert.equal(readJson(dir, CLAIM_PATH, {}).claims['2026-10-22:2'].fbPostId, 'fb-video-9');
});

test('dry run writes captions and does not post or mark the slot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-dry-'));
  const env = repoFor(dir);
  env.DRY_RUN = true;
  let posts = 0;
  await runFinish(require('../config.json'), env, {
    assertTools() { throw new Error('tools should not be required for a caption-only dry run'); },
    graphForm: async () => { posts += 1; return { id: 'x' }; }
  });
  assert.equal(posts, 0);
  assert.equal(readJson(dir, CLAIM_PATH, {}).claims['2026-10-22:2'].status, 'claimed');
  const cap = fs.readFileSync(path.join(env.OUT, 'instagram-caption.txt'), 'utf8');
  assert.match(cap, /Free weekly AI brief/);
  assert.doesNotMatch(cap, /\bdaily\b/i);
});
