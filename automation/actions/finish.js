// Finish social for a story that is already on the site and has no Instagram post.
// Manual workflow_dispatch only (FINISH_SLUG). Does not pick a new story or write posts-index.json.
// Posts a Reels-tab Reel (real story photo as the cover), the Instagram Story, and the Facebook
// post, then marks that slot posted. Each channel is skipped when it is already live.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CLAIM_PATH } = require('./lib/claim');
const { buildFb, checkFb } = require('./lib/captions');
const { readJson, writeJson, commitApply } = require('./lib/git');
const { writeClaim } = require('./lib/slotcommit');
const { assertReelsTools } = require('./lib/tools');
const { graphGet, graphForm, pollContainer, pollPublic, redact } = require('./lib/net');
const { renderReel, publishIgReel, publishFbVideo } = require('./lib/reels');
const {
  PROGRESS_PATH, SLUG_RE, igCaptionFromPost, photoUrlFromHtml, planFinish, pickEntry,
  storyImageName, assertPhotoFile
} = require('./lib/finish');

function facebookMessage(igCaption, sourceUrl) {
  const message = buildFb(igCaption);
  const errs = checkFb(message, sourceUrl);
  if (errs.length) throw new Error('Facebook caption layout check failed: ' + errs.join('; '));
  return message;
}

async function defaultFetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; aifeed-reels/1.0; +https://aifeed.run)',
      accept: 'text/html'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error('story page HTTP ' + res.status);
  return res.text();
}

async function defaultDownloadPhoto(url, dest) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; aifeed-reels/1.0; +https://aifeed.run)',
      accept: 'image/*'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(45000)
  });
  if (!res.ok) throw new Error('photo HTTP ' + res.status);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function authOf(env) {
  return { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
}

async function listSocial(cfg, env, graph) {
  const auth = authOf(env);
  const G = `https://graph.facebook.com/${cfg.graphVersion}/`;
  const ig = await graph(G + cfg.igUserId + '/media?fields=id,caption,media_type,media_product_type,permalink,timestamp&limit=30', auth);
  const fb = await graph(G + cfg.fbPageId + '/published_posts?fields=id,message,status_type,created_time,permalink_url&limit=25', auth);
  let videos = { data: [] };
  try {
    videos = await graph(G + cfg.fbPageId + '/videos?fields=id,description,title,created_time,permalink_url&limit=15', auth);
  } catch (e) {
    console.log('Facebook video list failed (published_posts still checked): ' + redact(e.message));
  }
  let stories = { data: [] };
  let storiesKnown = true;
  try {
    stories = await graph(G + cfg.igUserId + '/stories?fields=id,timestamp&limit=20', auth);
  } catch (e) {
    storiesKnown = false;
    console.log('Instagram stories list failed: ' + redact(e.message));
  }
  return {
    igMedia: ig.data || [],
    fbPosts: [...(fb.data || []), ...(videos.data || []).map(v => ({ ...v, isVideo: true }))],
    igStories: stories.data || [],
    storiesKnown
  };
}

async function saveProgress(io, env, slug, patch) {
  await io.commitApply(env.REPO, 'Finish progress: ' + slug, () => {
    const cur = io.readJson(env.REPO, PROGRESS_PATH, {});
    cur[slug] = Object.assign({}, cur[slug] || {}, patch, { slug, at: new Date().toISOString() });
    io.writeJson(env.REPO, PROGRESS_PATH, cur);
    return [PROGRESS_PATH];
  });
  return (io.readJson(env.REPO, PROGRESS_PATH, {}) || {})[slug] || {};
}

async function publishStory(cfg, env, io, storyUrl) {
  const auth = authOf(env);
  const base = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.igUserId}`;
  const container = await io.graphForm(base + '/media', { media_type: 'STORIES', image_url: storyUrl }, Object.assign({ tries: 3, waitMs: 15000 }, auth));
  if (!container.id) throw new Error('Instagram did not return a story container id');
  await io.pollContainer(cfg, env, container.id, { waitMs: 10000, maxAttempts: 12, label: 'IG story' });
  const published = await io.graphForm(base + '/media_publish', { creation_id: container.id }, Object.assign({ tries: 3, waitMs: 20000 }, auth));
  return published;
}

async function publishFacebookPhotos(cfg, env, io, imageUrl, message) {
  const auth = authOf(env);
  const base = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.fbPageId}`;
  const photo1 = await io.graphForm(base + '/photos', { url: imageUrl, published: 'false' }, Object.assign({ tries: 2, waitMs: 5000 }, auth));
  const photo2 = await io.graphForm(base + '/photos', { url: cfg.endCardUrl, published: 'false' }, Object.assign({ tries: 2, waitMs: 5000 }, auth));
  if (!photo1.id || !photo2.id) throw new Error('Facebook did not return photo ids');
  return io.graphForm(base + '/feed', {
    message,
    attached_media: JSON.stringify([{ media_fbid: photo1.id }, { media_fbid: photo2.id }])
  }, auth);
}

async function lookupPermalink(io, cfg, env, id, field) {
  try {
    const j = await io.graphGet(`https://graph.facebook.com/${cfg.graphVersion}/${id}?fields=${field}`, authOf(env));
    return j[field] || '';
  } catch (e) {
    console.log('permalink lookup failed: ' + redact(e.message));
    return '';
  }
}

async function ensureReel(cfg, env, io, post, entry, slug) {
  const videoRel = `videos/reels/${slug}.mp4`;
  const coverRel = `videos/reels/${slug}_cover.jpg`;
  const videoPath = path.join(env.REPO, videoRel);
  const coverPath = path.join(env.REPO, coverRel);
  if (fs.existsSync(videoPath) && fs.existsSync(coverPath)) {
    console.log('Reusing committed reel ' + videoRel);
    return { videoUrl: cfg.siteUrl + '/' + videoRel, coverUrl: cfg.siteUrl + '/' + coverRel };
  }
  const html = await io.fetchText(post.sourceUrl);
  const photoUrl = photoUrlFromHtml(html);
  if (!photoUrl) throw new Error('no og:image on the source page; refusing a Reel without the real story photo');
  console.log('Reel photo: ' + photoUrl);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aifeed-finish-'));
  const photoPath = path.join(tmp, 'photo.jpg');
  await io.downloadPhoto(photoUrl, photoPath);
  assertPhotoFile(photoPath, p => fs.readFileSync(p));
  const feedPath = path.join(env.REPO, 'images', entry.image);
  const rr = io.renderReel(env.REPO, Object.assign({}, post, { photoUrl }), feedPath, photoPath, {
    cloudflare: false,
    scene: photoPath,
    sceneSource: 'story',
    sceneCredit: ''
  });
  if (!rr || rr.sceneSource !== 'story' || !rr.cover || !fs.existsSync(rr.cover) || !fs.existsSync(rr.mp4)) {
    throw new Error('Reel did not render on the real story photo (scene ' + (rr && rr.sceneSource) + ')');
  }
  console.log('Reel scene: story (real photo cover) punch: ' + (rr.punch || '') + ' voice: ' + (rr.voice || 'none'));
  await io.commitApply(env.REPO, 'AIFeed reel: ' + slug, () => {
    fs.mkdirSync(path.join(env.REPO, 'videos/reels'), { recursive: true });
    fs.copyFileSync(rr.mp4, path.join(env.REPO, videoRel));
    fs.copyFileSync(rr.cover, path.join(env.REPO, coverRel));
    return [videoRel, coverRel];
  });
  return { videoUrl: cfg.siteUrl + '/' + videoRel, coverUrl: cfg.siteUrl + '/' + coverRel, credit: rr.credit || '' };
}

async function runFinish(cfg, env, deps = {}) {
  const io = Object.assign({
    assertTools: assertReelsTools,
    readJson,
    writeJson,
    commitApply,
    writeClaim,
    graphGet,
    graphForm,
    pollContainer,
    pollPublic,
    renderReel,
    publishIgReel,
    publishFbVideo,
    fetchText: defaultFetchText,
    downloadPhoto: defaultDownloadPhoto
  }, deps);
  const slug = String(env.FINISH_SLUG || '').trim();
  if (!SLUG_RE.test(slug)) throw new Error('finish_slug is not a lowercase story slug');
  const posts = io.readJson(env.REPO, '_posts/posts-index.json', null);
  if (!Array.isArray(posts)) throw new Error('posts-index.json could not be read');
  const post = posts.find(p => p && p.slug === slug);
  if (!post) throw new Error('No site post for slug ' + slug + '. Finish only posts social for a story already on the site.');
  if (!post.sourceUrl || !post.body || !post.imageUrl) throw new Error('site post ' + slug + ' is missing sourceUrl, body, or imageUrl');
  const history = io.readJson(env.REPO, '_data/history.json', { posted: [] });
  const claimsDoc = io.readJson(env.REPO, CLAIM_PATH, { claims: {} });
  const entry = pickEntry(history, claimsDoc, slug);
  if (!entry || !entry.image) throw new Error('history.json has no slot for slug ' + slug);
  const key = `${entry.date}:${Number(entry.slot)}`;
  const row = (claimsDoc.claims && claimsDoc.claims[key]) || {};
  if (String(row.status || '').toLowerCase() === 'posted' && row.slug && row.slug !== slug) {
    throw new Error('slot ' + key + ' is already posted as ' + row.slug);
  }
  const feedRel = path.join(env.REPO, 'images', entry.image);
  const storyRel = path.join(env.REPO, 'images', storyImageName(entry.image));
  if (!fs.existsSync(feedRel)) throw new Error('feed image missing: images/' + entry.image);
  if (!fs.existsSync(storyRel)) throw new Error('story image missing: images/' + storyImageName(entry.image));
  const caption = igCaptionFromPost(post);
  const fbMessage = facebookMessage(caption, post.sourceUrl);
  console.log('Finish ' + slug + ' slot ' + key + ' (already on the site; Reels tab only; real photo cover)');
  console.log('IG caption layout ok (' + caption.length + ' chars, weekly brief, no human-editing claim)');
  if (env.DRY_RUN) {
    fs.mkdirSync(env.OUT, { recursive: true });
    fs.writeFileSync(path.join(env.OUT, 'instagram-caption.txt'), caption + '\n');
    fs.writeFileSync(path.join(env.OUT, 'facebook-caption.txt'), fbMessage + '\n');
    console.log('DRY RUN finish. Reel, Story and Facebook were not posted. Slot ' + key + ' was not changed.');
    return 0;
  }
  io.assertTools();
  const storyUrl = cfg.siteUrl + '/images/' + storyImageName(entry.image);
  let progress = (io.readJson(env.REPO, PROGRESS_PATH, {}) || {})[slug] || {};
  const listed = await listSocial(cfg, env, io.graphGet);
  let plan = planFinish({
    sourceUrl: post.sourceUrl,
    progress,
    igMedia: listed.igMedia,
    fbPosts: listed.fbPosts,
    igStories: listed.igStories,
    storiesKnown: listed.storiesKnown
  });
  if (plan.error) throw new Error(plan.error);

  let video = null;
  if (!plan.done && (plan.postReel || plan.postFb)) {
    video = await ensureReel(cfg, env, io, post, entry, slug);
    await io.pollPublic(video.videoUrl, { firstWaitMs: 0, retryWaitMs: 20000, maxAttempts: 15 });
    if (video.coverUrl) await io.pollPublic(video.coverUrl, { firstWaitMs: 0, retryWaitMs: 20000, maxAttempts: 15 });
  }

  let igReelId = plan.igReelId;
  let igStoryId = plan.igStoryId;
  let fbPostId = plan.fbPostId;
  if (plan.postReel) {
    const reelCaption = caption;
    const published = await io.publishIgReel(cfg, env, { graphForm: io.graphForm, pollContainer: io.pollContainer }, video.videoUrl, reelCaption, video.coverUrl);
    igReelId = String(published.id || '');
    if (!igReelId) throw new Error('Instagram did not return a Reel id');
    const permalink = await lookupPermalink(io, cfg, env, igReelId, 'permalink');
    console.log('Instagram Reel published ' + igReelId + (permalink ? ' ' + permalink : '') + ' (Reels tab only, real photo cover)');
    progress = await saveProgress(io, env, slug, { igReelId, igPermalink: permalink });
  } else if (igReelId) {
    console.log('Instagram Reel already posted ' + igReelId + ' — skipping');
  }

  if (plan.postStory) {
    if (!progress.storyAttemptAt) progress = await saveProgress(io, env, slug, { storyAttemptAt: new Date().toISOString() });
    await io.pollPublic(storyUrl, { firstWaitMs: 0, retryWaitMs: 15000, maxAttempts: 8 });
    const published = await publishStory(cfg, env, io, storyUrl);
    igStoryId = String(published.id || '');
    if (!igStoryId) throw new Error('Instagram did not return a story id');
    console.log('Instagram story published ' + igStoryId);
    progress = await saveProgress(io, env, slug, { igStoryId });
  } else if (igStoryId) {
    console.log('Instagram story already posted ' + igStoryId + ' — skipping');
  }

  if (plan.postFb) {
    try {
      if (!video) video = await ensureReel(cfg, env, io, post, entry, slug);
      const v = await io.publishFbVideo(cfg, env, { graphForm: io.graphForm }, video.videoUrl, fbMessage, post.headline);
      fbPostId = String(v.post_id || v.id || '');
      if (!fbPostId) throw new Error('Facebook did not return a video id');
      console.log('Facebook video published ' + fbPostId);
    } catch (e) {
      console.log('Facebook video failed, posting the feed photos instead: ' + redact(e.message));
      await io.pollPublic(post.imageUrl, { firstWaitMs: 0, retryWaitMs: 15000, maxAttempts: 6 });
      const photoPost = await publishFacebookPhotos(cfg, env, io, post.imageUrl, fbMessage);
      fbPostId = String(photoPost.id || '');
      if (!fbPostId) throw new Error('Facebook did not return a post id');
    }
    const permalink = await lookupPermalink(io, cfg, env, fbPostId, 'permalink_url');
    console.log('Facebook post published ' + fbPostId + (permalink ? ' ' + permalink : ''));
    progress = await saveProgress(io, env, slug, { fbPostId, fbPermalink: permalink });
  } else if (fbPostId) {
    console.log('Facebook post already posted ' + fbPostId + ' — skipping');
  }

  if (!igReelId || !igStoryId || !fbPostId) {
    throw new Error('Finish incomplete for ' + slug + ' reel=' + (igReelId || 'missing') + ' story=' + (igStoryId || 'missing') + ' fb=' + (fbPostId || 'missing'));
  }
  const alreadyPosted = String(row.status || '').toLowerCase() === 'posted' && row.slug === slug
    && row.igReelId === igReelId && row.igStoryId === igStoryId && row.fbPostId === fbPostId;
  if (!alreadyPosted) {
    await io.writeClaim(env, { date: entry.date, slot: Number(entry.slot) }, 'posted', {
      extra: { slug, image: entry.image, igReelId, igStoryId, fbPostId }
    });
    console.log('Marked slot ' + key + ' posted');
  } else {
    console.log('Slot ' + key + ' was already posted');
  }
  console.log('FINISH PUBLISHED ' + JSON.stringify({ slug, slot: key, igReelId, igStoryId, fbPostId }));
  return 0;
}

module.exports = { runFinish, facebookMessage };
