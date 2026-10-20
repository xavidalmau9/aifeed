#!/usr/bin/env node
// AIFeed autopilot: same story selection, captions, graphics, and Instagram carousel as the live n8n workflow.
// Dry run renders and writes files under OUT_DIR and does not claim, commit, or post.
const fs = require('fs');
const path = require('path');
const { bufferLinkedinEnabled, bufferLinkedinText, bufferLinkedinPost } = require('./lib/buffer');
const { decideRun } = require('./lib/schedule');
const { CLAIM_PATH, evaluateClaim, updateClaimDoc, SlotTaken } = require('./lib/claim');
const { fetchFeeds, assembleCandidates } = require('./lib/rss');
const { orderPool, buildSameEventPrompt, classifySameEvent, finalizeSameEvent } = require('./lib/pick');
const { fetchArticles } = require('./lib/articles');
const { refinePhotos, loadRecentPrints, applyPhotoBackfill, buildPhotoJudgePrompt, parsePhotoVerdict } = require('./lib/photos');
const { parseModelArray, runQuality, applyAccuracyFix, layoutErrors, mergeLiCaption, assemblePublish, mergeHistory } = require('./lib/quality');
const { sourceCheckAll, verifyCandidate, checkLiExpansion } = require('./lib/factcheck');
const { assertFeedPng, assertStoryPng } = require('./lib/png');
const { renderHtml, closeBrowser } = require('./render');
const { readJson, writeJson, commitApply, git } = require('./lib/git');
const {
  claudeMessage, claudeVision, fetchIgMedia, graphForm, graphGet, pollContainer, pollPublic, linkedinEnabled, linkedInPost, redact
} = require('./lib/net');
const { sendAlert } = require('./alert');
const { buildFb, checkFb } = require('./lib/captions');
const { renderReel, renderSlides, withPhotoCredit, publishIgReel, publishFbVideo } = require('./lib/reels');
const { reelBrief } = require('./lib/reelbrief');
const { isReelsOnly, carouselUpfront, carouselFallback, fbPhotoNeeded } = require('./lib/reelsplan');

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
}

function truthy(v) {
  return v === '1' || v === 'true' || v === true;
}

function runtimeEnv() {
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    META_PAGE_TOKEN: process.env.META_PAGE_TOKEN || '',
    META_APP_SECRET: process.env.META_APP_SECRET || '',
    LINKEDIN_ACCESS_TOKEN: process.env.LINKEDIN_ACCESS_TOKEN || '',
    BUFFER_API_KEY: process.env.BUFFER_API_KEY || '',
    DRY_RUN: truthy(process.env.DRY_RUN),
    SLOT: process.env.SLOT || 'auto',
    EVENT_NAME: process.env.EVENT_NAME || 'schedule',
    TAKE_OVER: truthy(process.env.TAKE_OVER),
    REPO: process.env.REPO_ROOT || path.resolve(__dirname, '..', '..'),
    OUT: process.env.OUT_DIR || path.join(__dirname, 'out')
  };
}

function syncMain(repo) {
  git(repo, ['fetch', 'origin', 'main']);
  git(repo, ['checkout', 'main']);
  git(repo, ['reset', '--hard', 'origin/main']);
}

function writeClaim(env, decision, status, { takeOver = false, extra } = {}) {
  const label = Number(decision.slot) === 1 ? 'am' : 'pm';
  const message = status === 'claimed'
    ? `Claim slot ${decision.date} ${label}`
    : status === 'posted'
      ? `Posted slot ${decision.date} ${label}`
      : `Release slot ${decision.date} ${label}`;
  commitApply(env.REPO, message, () => {
    const freshHist = readJson(env.REPO, '_data/history.json', { posted: [], rankings: {} });
    const freshClaims = readJson(env.REPO, CLAIM_PATH, { claims: {} });
    if (status === 'claimed') {
      const gate = evaluateClaim({
        claimsDoc: freshClaims, history: freshHist, date: decision.date, slot: decision.slot, takeOver
      });
      if (!gate.ok) throw new SlotTaken(gate.reason);
    }
    const next = updateClaimDoc(freshClaims, {
      date: decision.date,
      slot: decision.slot,
      status,
      at: new Date().toISOString(),
      by: 'github-actions',
      extra,
      takeOver: status === 'claimed' && takeOver
    });
    if (!next.ok) throw new SlotTaken(next.reason);
    writeJson(env.REPO, CLAIM_PATH, next.doc);
    return [CLAIM_PATH];
  });
}

// imageUrls: the v2 slide URLs (cover, key points, CTA), or a single feed-graphic URL (legacy: + the static end card).
async function publishInstagram(cfg, env, imageUrls, caption) {
  const auth = { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
  const base = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.igUserId}`;
  const urls = Array.isArray(imageUrls) ? imageUrls.slice(0, 10) : [imageUrls, cfg.endCardUrl];
  const ids = [];
  for (const u of urls) {
    const child = await graphForm(base + '/media', { image_url: u, is_carousel_item: 'true' }, Object.assign({ tries: 3, waitMs: 15000 }, auth));
    if (!child.id) throw new Error('Instagram did not return carousel child ids');
    ids.push(child.id);
  }
  const carousel = await graphForm(base + '/media', {
    media_type: 'CAROUSEL',
    children: ids.join(','),
    caption
  }, auth);
  if (!carousel.id) throw new Error('Instagram did not return a carousel id');
  await pollContainer(cfg, env, carousel.id, { waitMs: 15000, maxAttempts: 12, label: 'IG carousel' });
  const published = await graphForm(base + '/media_publish', { creation_id: carousel.id }, Object.assign({ tries: 3, waitMs: 20000 }, auth));
  console.log('Instagram carousel published ' + (published.id || carousel.id));
  return published;
}

async function publishStory(cfg, env, storyUrl) {
  const auth = { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
  const base = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.igUserId}`;
  const container = await graphForm(base + '/media', { media_type: 'STORIES', image_url: storyUrl }, Object.assign({ tries: 3, waitMs: 15000 }, auth));
  if (!container.id) throw new Error('Instagram did not return a story container id');
  await pollContainer(cfg, env, container.id, { waitMs: 10000, maxAttempts: 12, label: 'IG story' });
  const published = await graphForm(base + '/media_publish', { creation_id: container.id }, Object.assign({ tries: 3, waitMs: 20000 }, auth));
  console.log('Instagram story published ' + (published.id || container.id));
  return published;
}

// Facebook Page post = the same feed graphic + end card (2 photos) with the Instagram caption
// (same blocks, spacers, Source line once; CTA says aifeed.run instead of "link in bio").
function facebookMessage(igCaption, sourceUrl) {
  const message = buildFb(igCaption);
  const errs = checkFb(message, sourceUrl);
  if (errs.length) throw new Error('Facebook caption layout check failed: ' + errs.join('; '));
  return message;
}

async function publishFacebook(cfg, env, imageUrl, igCaption, sourceUrl) {
  const auth = { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
  const base = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.fbPageId}`;
  const message = facebookMessage(igCaption, sourceUrl);
  const photo1 = await graphForm(base + '/photos', { url: imageUrl, published: 'false' }, Object.assign({ tries: 2, waitMs: 5000 }, auth));
  const photo2 = await graphForm(base + '/photos', { url: cfg.endCardUrl, published: 'false' }, Object.assign({ tries: 2, waitMs: 5000 }, auth));
  if (!photo1.id || !photo2.id) throw new Error('Facebook did not return photo ids');
  const post = await graphForm(base + '/feed', {
    message,
    attached_media: JSON.stringify([{ media_fbid: photo1.id }, { media_fbid: photo2.id }])
  }, auth);
  console.log('Facebook post published ' + (post.id || ''));
  return post;
}

// Dry-run check that the Page token can post to the Page (read-only: debug_token, nothing is created).
async function facebookPreflight(cfg, env) {
  if (!env.META_APP_SECRET) return 'skipped (META_APP_SECRET not set)';
  const u = new URL(`https://graph.facebook.com/${cfg.graphVersion}/debug_token`);
  u.searchParams.set('input_token', env.META_PAGE_TOKEN);
  u.searchParams.set('access_token', cfg.metaAppId + '|' + env.META_APP_SECRET);
  const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
  const d = ((await res.json().catch(() => ({}))).data) || {};
  const scopes = d.scopes || [];
  const ok = d.is_valid && d.type === 'PAGE' && String(d.profile_id) === String(cfg.fbPageId) && scopes.includes('pages_manage_posts');
  return (ok ? 'OK' : 'PROBLEM') + ': token type ' + d.type + ', page ' + d.profile_id + ', valid ' + d.is_valid
    + ', pages_manage_posts ' + (scopes.includes('pages_manage_posts') ? 'yes' : 'NO')
    + ', expires ' + (d.expires_at === 0 ? 'never' : d.expires_at);
}

async function main() {
  const cfg = loadConfig();
  const env = runtimeEnv();
  if (!env.ANTHROPIC_API_KEY || !env.META_PAGE_TOKEN) {
    console.log('ANTHROPIC_API_KEY or META_PAGE_TOKEN is not set. Nothing will be posted.');
    return 0;
  }
  if (env.EVENT_NAME === 'workflow_dispatch' && !env.DRY_RUN && require('./repost').hasRequest(env.REPO)) {
    console.log('Repost request found: redoing one post instead of a normal run');
    return require('./repost').runRepost(cfg, env, { publishInstagram, publishStory });
  }
  const decision = decideRun({ now: new Date(), eventName: env.EVENT_NAME, slotInput: env.SLOT });
  console.log(decision.reason);
  if (!decision.run) return 0;

  // AIFEED_NO_RESET=1 (dry runs only; set by no workflow that posts) keeps a branch checkout so a dry run tests the
  // branch's own Python renderers instead of main's. Live runs always reset to main.
  if (process.env.GITHUB_ACTIONS === 'true' && !(env.DRY_RUN && process.env.AIFEED_NO_RESET === '1')) syncMain(env.REPO);

  const posts = readJson(env.REPO, '_posts/posts-index.json', null);
  const history = readJson(env.REPO, '_data/history.json', { posted: [], rankings: {} });
  const claimsDoc = readJson(env.REPO, CLAIM_PATH, { claims: {} });
  if (!Array.isArray(posts) || !posts.length) {
    throw new Error('Dedupe safety stop: website post history could not be loaded (GitHub API, raw and site JSON all failed) - nothing posted');
  }
  const gate = evaluateClaim({
    claimsDoc, history, date: decision.date, slot: decision.slot, takeOver: env.TAKE_OVER && !env.DRY_RUN
  });
  console.log(gate.reason);
  if (!gate.ok) {
    if (!env.DRY_RUN) return 0;
    // A dry run writes nothing, so preview the pick anyway (the artifact upload needs files).
    console.log('Dry run: a real run would SKIP here; continuing the preview without claiming');
  }

  let claimed = false;
  let contentCommitted = false;
  const release = async () => {
    if (!claimed || contentCommitted || env.DRY_RUN) return;
    try {
      writeClaim(env, decision, 'released');
      claimed = false;
      console.log('Released slot claim because nothing was published');
    } catch (e) {
      console.log('Could not release slot claim: ' + redact(e.message));
    }
  };

  try {
    if (!env.DRY_RUN) {
      try {
        writeClaim(env, decision, 'claimed', { takeOver: env.TAKE_OVER });
        claimed = true;
        console.log('Claimed ' + decision.date + ':' + decision.slot);
      } catch (e) {
        if (e.code === 'SLOT_TAKEN' || e instanceof SlotTaken) {
          console.log('SKIP: ' + e.message);
          return 0;
        }
        throw e;
      }
    } else {
      console.log('Dry run: claim file will not be written');
    }

    let igMedia = [];
    try {
      igMedia = await fetchIgMedia(cfg, env);
      console.log('Instagram history: ' + igMedia.length + ' captions');
    } catch (e) {
      console.log('Instagram history FAILED - using website + log only: ' + redact(e.message));
    }

    const items = await fetchFeeds();
    console.log('RSS items in window: ' + items.length);
    const assembled = assembleCandidates({ posts, igMedia, history, items });
    console.log('Fresh candidates: ' + assembled.fresh.length + ' history ' + JSON.stringify(assembled.historyCounts));

    const rankText = await claudeMessage(env.ANTHROPIC_API_KEY, {
      model: cfg.anthropicModel, prompt: assembled.rankPrompt, maxTokens: 2500
    });
    const ordered = orderPool({
      slot: decision.slot, today: decision.date, fresh: assembled.fresh, history: assembled.history, rankText
    });
    const sameText = await claudeMessage(env.ANTHROPIC_API_KEY, {
      model: cfg.anthropicModel,
      prompt: buildSameEventPrompt(ordered.pool, assembled.postedCompact),
      maxTokens: 3000,
      temperature: 0
    });
    const classified = classifySameEvent(ordered.pool, assembled.postedCompact, sameText);
    // A repeat verdict whose match shares no key entity (or is not in the history) gets one confirming call
    // with just that pair. Unsure counts as a repeat; an unreadable answer stops the run.
    const confirmTexts = {};
    for (const r of classified.filter(x => x.status === 'confirm')) {
      confirmTexts[r.i] = await claudeMessage(env.ANTHROPIC_API_KEY, {
        model: cfg.anthropicModel, prompt: r.prompt, maxTokens: 300, temperature: 0
      });
    }
    const dropped = finalizeSameEvent(ordered.pool, classified, confirmTexts);
    console.log('Same-event kept ' + dropped.candidates.length + ', skipped ' + dropped.sameEventSkipped.length
      + ', repeat verdicts overturned after a pair check ' + dropped.sameEventOverturned.length);
    dropped.sameEventSkipped.forEach(s => console.log('  same-event skip: ' + s.title + ' => ' + (s.matched || '') + ' (' + s.reason + ')'));
    dropped.sameEventOverturned.forEach(s => console.log('  same-event overturned (new): ' + s.title + ' vs ' + s.wrongMatch + ' (' + s.note + '; ' + s.why + ')'));

    const articles = await fetchArticles(dropped.candidates, { probe: false });
    const recentPhotos = await loadRecentPrints({
      history,
      posts,
      imagesDir: path.join(env.REPO, 'images'),
      limit: cfg.photoRecent || 14
    });
    console.log('Recent photo fingerprints: ' + recentPhotos.prints.length
      + ' (' + recentPhotos.backfill.length + ' read from images/)');
    const photoPick = await refinePhotos(articles.usable, {
      recent: recentPhotos.prints,
      stockKeys: { unsplash: process.env.UNSPLASH_ACCESS_KEY || '', pexels: process.env.PEXELS_API_KEY || '' },
      judge: async (jpeg, meta) => {
        const text = await claudeVision(env.ANTHROPIC_API_KEY, {
          model: cfg.anthropicModel,
          text: buildPhotoJudgePrompt(meta.headline, meta.summary),
          image: jpeg,
          maxTokens: 300,
          temperature: 0,
          tries: 2
        });
        const verdict = parsePhotoVerdict(text);
        if (!verdict) throw new Error('photo judge returned no JSON');
        return verdict;
      }
    });
    photoPick.lines.forEach(l => console.log(l));
    const captionText = await claudeMessage(env.ANTHROPIC_API_KEY, {
      model: cfg.anthropicModel, prompt: articles.captionPrompt, maxTokens: 6000
    });
    let gen0;
    try { gen0 = parseModelArray(captionText); } catch (e) {
      throw new Error('Caption JSON parse failed: ' + String(captionText || '').slice(0, 200));
    }
    // Source fact check: every headline/summary/hook/body sentence against the fetched article (or RSS description).
    const ask = prompt => claudeMessage(env.ANTHROPIC_API_KEY, {
      model: cfg.anthropicModel, prompt, maxTokens: 4000, temperature: 0
    });
    const checked = await sourceCheckAll({ gen: gen0, usable: articles.usable, ask });
    const sourceCheckLog = checked.log.slice();
    checked.log.forEach(l => console.log('  source check C' + l.candidate + ' ' + l.status + ': ' + l.title.slice(0, 70)
      + (l.changes.length ? ' [' + l.changes.join(', ') + ']' : '') + (l.status === 'fail' ? ' (' + l.problems.join('; ').slice(0, 300) + ')' : '')));
    let gen = checked.gen;
    let qc = runQuality({ usable: articles.usable, gen, fixPass: false });
    if (qc.accuracyRetry) {
      console.log('Accuracy fix for candidate ' + qc.accuracyCandidate + ': ' + qc.accuracyProblems.join('; '));
      let fixText = '';
      try {
        fixText = await claudeMessage(env.ANTHROPIC_API_KEY, {
          model: cfg.anthropicModel, prompt: qc.accuracyPrompt, maxTokens: 3000, temperature: 0
        });
      } catch (e) {
        console.log('Accuracy regeneration failed: ' + redact(e.message));
      }
      const accuracyCandidate = qc.accuracyCandidate;
      gen = JSON.parse(JSON.stringify(gen));
      const fixNote = applyAccuracyFix(gen, { fixText, accuracyCandidate });
      console.log('  ' + fixNote);
      const fixed = gen.find(x => x.candidate === accuracyCandidate);
      if (fixed && /^accuracy regenerated/.test(fixNote)) {
        // The accuracy fix is already this candidate's one rewrite: verify it, no further rewriting.
        const r = await verifyCandidate({ c: articles.usable[accuracyCandidate], g: fixed, ask });
        sourceCheckLog.push({ candidate: accuracyCandidate, title: articles.usable[accuracyCandidate].title, status: 'after accuracy fix: ' + r.status, changes: r.changes, problems: r.problems });
        console.log('  source check (after accuracy fix) C' + accuracyCandidate + ' ' + r.status + (r.problems.length ? ' (' + r.problems.join('; ').slice(0, 300) + ')' : ''));
      }
      qc = runQuality({ usable: articles.usable, gen, fixPass: true, preApplied: true, accuracyCandidate });
    }
    const layout = layoutErrors(qc.gen, qc.story);
    if (layout.length) throw new Error('IG caption layout/accuracy check failed: ' + layout.join('; '));

    let liCaption = qc.gen.liCaption;
    let liWarning = qc.liShort ? `LinkedIn caption short (${qc.liWords} words)` : null;
    if (qc.liShort && qc.liExpandPrompt) {
      try {
        const expanded = await claudeMessage(env.ANTHROPIC_API_KEY, {
          model: cfg.anthropicModel, prompt: qc.liExpandPrompt, maxTokens: 2000, tries: 2
        });
        const liCheck = await checkLiExpansion({ c: qc.story, gen: qc.gen, expandedText: expanded, ask });
        if (liCheck.ok) {
          const merged = mergeLiCaption(qc.gen, qc.story.link, expanded, liCaption);
          liCaption = merged.liCaption;
          liWarning = merged.liWarning;
        } else {
          liWarning = 'LinkedIn expansion failed source check - kept original';
          console.log(liWarning + ': ' + liCheck.reason);
        }
      } catch (e) {
        liWarning = 'LinkedIn retry failed - posted original';
        console.log(liWarning + ': ' + redact(e.message));
      }
    }

    console.log('Rendering feed graphic');
    const feed = await renderHtml(qc.html, { width: 1080, height: 1350, waitMs: 3000 });
    assertFeedPng(feed.png);
    const published = assemblePublish({
      story: qc.story,
      gen: qc.gen,
      category: qc.category,
      liCaption,
      liWarning,
      today: decision.date,
      slot: decision.slot,
      siteUrl: cfg.siteUrl
    });
    console.log('Story: ' + qc.story.title);
    console.log('Photo: ' + (qc.story.photoSource || 'og:image') + ' — ' + (qc.story.photoWhy || '') + ' — ' + (qc.story.ogImage || ''));
    console.log('Image: ' + published.pngName);

    // v2 carousel + Story (Reel design): one Reel brief (punch headline + scene idea) and ONE scene pick, shared with the
    // Reel below. Live posts may use Cloudflare here (this is then the only Cloudflare call; the Reel reuses the scene);
    // dry runs never do. Any failure falls back to the legacy feed graphic + end card and the HTML Story.
    let brief = null, slides = null;
    const feedTmp = path.join(require('os').tmpdir(), published.pngName);
    fs.writeFileSync(feedTmp, feed.png);
    const getBrief = async () => {
      if (!brief) brief = await reelBrief(published.post, prompt => claudeMessage(env.ANTHROPIC_API_KEY, { model: cfg.anthropicModel, prompt, maxTokens: 400, temperature: 0.4, tries: 2 }));
      return brief;
    };
    try {
      await getBrief();
      slides = renderSlides(env.REPO, Object.assign({}, published.post, brief), feedTmp, published.post.photoUrl || qc.story.ogImage || '', { cloudflare: !env.DRY_RUN });
      slides.pngs = slides.slides.map(p => fs.readFileSync(p));
      slides.pngs.forEach(assertFeedPng);
      slides.storyPng = fs.readFileSync(slides.story);
      assertStoryPng(slides.storyPng);
      slides.names = slides.pngs.map((_, i) => i === 0 ? published.pngName : published.pngName.replace(/\.png$/, '_s' + (i + 1) + '.png'));
      console.log('Carousel v2: ' + slides.pngs.length + ' slides, scene ' + slides.sceneSource + ' (' + (slides.sceneLog || []).join('; ') + ')');
    } catch (e) {
      slides = null;
      console.log('Carousel v2 FAILED, using the legacy feed graphic + end card: ' + redact(e.message));
      if (!env.DRY_RUN) await sendAlert('AIFeed: carousel v2 render failed (legacy graphic used)\n' + redact(e.message));
    }
    const reelSceneOpts = slides ? { scene: slides.scene, sceneSource: slides.sceneSource, sceneCredit: slides.credit } : {};
    const slideUrls = () => slides ? slides.names.map(n => cfg.siteUrl + '/images/' + n) : published.post.imageUrl;

    if (env.DRY_RUN) {
      console.log('Rendering story graphic for dry-run artifacts');
      const story = slides ? { png: slides.storyPng, fit: 'v2' } : await renderHtml(qc.storyHtml, { width: 1080, height: 1920, waitMs: 3000 });
      assertStoryPng(story.png);
      fs.mkdirSync(env.OUT, { recursive: true });
      if (slides) slides.names.forEach((n, i) => fs.writeFileSync(path.join(env.OUT, n), slides.pngs[i]));
      fs.writeFileSync(path.join(env.OUT, published.pngName), slides ? slides.pngs[0] : feed.png); // same file the live run commits
      fs.writeFileSync(path.join(env.OUT, published.storyName), story.png);
      fs.writeFileSync(path.join(env.OUT, 'instagram-caption.txt'), published.igCaption + '\n');
      fs.writeFileSync(path.join(env.OUT, 'linkedin-caption.txt'), published.liCaption + '\n');
      fs.writeFileSync(path.join(env.OUT, 'story.json'), JSON.stringify({
        date: decision.date,
        slot: decision.slot,
        headline: qc.story.title,
        url: qc.story.link,
        pngName: published.pngName,
        storyName: published.storyName,
        outlet: qc.gen.outlet,
        failures: qc.failures,
        sourceCheck: sourceCheckLog,
        photo: qc.story.ogImage,
        photoSource: qc.story.photoSource || '',
        photoWhy: qc.story.photoWhy || '',
        photoLog: photoPick.lines,
        sameEventSkipped: dropped.sameEventSkipped,
        sameEventOverturned: dropped.sameEventOverturned,
        cheapDedupSkipped: assembled.dedupSkipped,
        historyCounts: assembled.historyCounts,
        liWarning: published.liWarning,
        fit: { feed: feed.fit, story: story.fit }
      }, null, 2) + '\n');
      if (cfg.fbEnabled) {
        const fbMessage = facebookMessage(published.igCaption, qc.story.link);
        fs.writeFileSync(path.join(env.OUT, 'facebook-caption.txt'), fbMessage + '\n');
        console.log('Facebook plan: Page ' + cfg.fbPageId + ' post = feed graphic + end card (2 photos), caption '
          + fbMessage.length + ' chars, Source line x1, URL x1, after the Instagram post + Story (a Facebook failure only alerts)');
        try { console.log('Facebook preflight ' + await facebookPreflight(cfg, env)); }
        catch (e) { console.log('Facebook preflight FAILED: ' + redact(e.message)); }
      } else {
        console.log('Facebook plan: disabled (fbEnabled false)');
      }
      if (cfg.reelsEnabled) {
        try {
          const fp = path.join(env.OUT, published.pngName);
          await getBrief();
          console.log('Reel brief: ' + JSON.stringify(brief));
          const rr = renderReel(env.REPO, Object.assign({}, published.post, brief), fp, published.post.photoUrl || qc.story.ogImage || '', Object.assign({ cloudflare: false }, reelSceneOpts)); // dry run: never spend the Cloudflare quota
          console.log('Reel scene: ' + rr.sceneSource + ' (' + (rr.sceneLog || []).join('; ') + ') punch: ' + rr.punch);
          fs.copyFileSync(rr.mp4, path.join(env.OUT, published.slug + '.mp4'));
          if (rr.cover) fs.copyFileSync(rr.cover, path.join(env.OUT, published.slug + '_cover.jpg'));
          if (rr.credit) console.log('Reel caption would carry: ' + withPhotoCredit('', rr.credit).trim());
          console.log('Reel rendered for dry-run artifacts');
        } catch (e) { console.log('Reel render FAILED: ' + redact(e.message)); }
      }
      console.log('DRY RUN complete. Nothing was posted or committed. Artifacts: ' + env.OUT);
      return 0;
    }

    contentCommitted = true;
    const headline = published.post.headline;
    commitApply(env.REPO, 'Publish: ' + headline.substring(0, 60), () => {
      const freshPosts = readJson(env.REPO, '_posts/posts-index.json', []);
      const freshHist = readJson(env.REPO, '_data/history.json', { posted: [], rankings: {} });
      applyPhotoBackfill(freshHist, recentPhotos.backfill);
      const imageRel = 'images/' + published.pngName;
      fs.mkdirSync(path.join(env.REPO, 'images'), { recursive: true });
      fs.writeFileSync(path.join(env.REPO, imageRel), slides ? slides.pngs[0] : feed.png);
      const extra = slides ? slides.names.slice(1).map((n, i) => {
        fs.writeFileSync(path.join(env.REPO, 'images', n), slides.pngs[i + 1]); return 'images/' + n;
      }) : [];
      const nextPosts = freshPosts.some(p => p && p.id === published.post.id) ? freshPosts : [published.post, ...freshPosts];
      writeJson(env.REPO, '_posts/posts-index.json', nextPosts);
      writeJson(env.REPO, '_data/history.json', mergeHistory(freshHist, {
        entry: published.historyEntry,
        rankings: ordered.rankings
      }));
      return [imageRel, ...extra, '_posts/posts-index.json', '_data/history.json'];
    });
    console.log('Committed feed image, posts index, and history');

    console.log('Waiting for ' + published.post.imageUrl);
    await pollPublic(published.post.imageUrl);
    if (slides) for (const u of slideUrls().slice(1)) await pollPublic(u);
    // igCarouselEnabled false = Reels-only feed: the carousel only runs as a fallback when the Reel does not publish.
    const reelsOnly = isReelsOnly(cfg);
    const markPosted = () => {
      try { writeClaim(env, decision, 'posted', { extra: { slug: published.slug, image: published.pngName } }); }
      catch (e) { console.log('Could not mark claim posted: ' + redact(e.message)); }
    };
    let reelPublished = false, fbVideoDone = false;
    if (carouselUpfront(cfg)) {
      await publishInstagram(cfg, env, slideUrls(), published.igCaption);
      markPosted();
    } else {
      console.log('Instagram carousel skipped (igCarouselEnabled false); the Reel is the feed post');
    }

    try {
      console.log('Rendering Instagram story');
      const story = slides ? { png: slides.storyPng } : await renderHtml(qc.storyHtml, { width: 1080, height: 1920, waitMs: 3000 });
      assertStoryPng(story.png);
      commitApply(env.REPO, 'AIFeed story image: ' + published.storyName, () => {
        const rel = 'images/' + published.storyName;
        fs.mkdirSync(path.join(env.REPO, 'images'), { recursive: true });
        fs.writeFileSync(path.join(env.REPO, rel), story.png);
        return [rel];
      });
      console.log('Waiting for ' + published.storyUrl);
      await pollPublic(published.storyUrl);
      await publishStory(cfg, env, published.storyUrl);
    } catch (e) {
      const msg = 'AIFeed: Instagram Story failed (feed post unaffected)\n' + redact(e.message);
      console.log(msg);
      await sendAlert(msg);
    }

    // Reel: render + commit videos/reels/<slug>.mp4, then IG Reel + FB video. Sets post.videoUrl so LinkedIn (Buffer) posts the video.
    if (cfg.reelsEnabled) {
      try {
        const tmpPng = feedTmp;
        // Pass the story's own photo (og:image picked by refinePhotos) so the Reel is photo-first, not a Commons stand-in.
        // Punch headline + story-themed scene prompt (one short call on the existing model; make_reel falls back to rules).
        await getBrief();
        console.log('Reel brief: ' + JSON.stringify(brief));
        // live post: reuses the carousel's scene (no second Cloudflare call); Cloudflare only if the slides failed
        const rr = renderReel(env.REPO, Object.assign({}, published.post, brief), tmpPng, published.post.photoUrl || qc.story.ogImage || '', Object.assign({ cloudflare: !slides }, reelSceneOpts));
        console.log('Reel scene: ' + rr.sceneSource + ' (' + (rr.sceneLog || []).join('; ') + ') punch: ' + rr.punch);
        const rel = 'videos/reels/' + published.slug + '.mp4';
        const coverRel = rr.cover ? 'videos/reels/' + published.slug + '_cover.jpg' : '';
        commitApply(env.REPO, 'AIFeed reel: ' + published.slug, () => {
          fs.mkdirSync(path.join(env.REPO, 'videos/reels'), { recursive: true });
          fs.copyFileSync(rr.mp4, path.join(env.REPO, rel));
          if (coverRel) fs.copyFileSync(rr.cover, path.join(env.REPO, coverRel));
          return coverRel ? [rel, coverRel] : [rel];
        });
        const videoUrl = cfg.siteUrl + '/' + rel;
        const coverUrl = coverRel ? cfg.siteUrl + '/' + coverRel : '';
        await pollPublic(videoUrl);
        if (coverUrl) await pollPublic(coverUrl);
        const reelCaption = withPhotoCredit(published.igCaption, rr.credit);
        published.post.videoUrl = videoUrl;
        if (cfg.reelsPublishEnabled) {
          // IG Reel and FB video are independent: an IG Reel failure only alerts (or triggers the carousel fallback in
          // Reels-only mode) and the FB Page still gets the video.
          try {
            const r = await publishIgReel(cfg, env, { graphForm, pollContainer }, videoUrl, reelCaption, coverUrl);
            console.log('Instagram Reel published ' + (r.id || '') + (cfg.reelsShareToFeed === false ? ' (Reels tab only, not in feed)' : ''));
            reelPublished = true;
            if (reelsOnly) markPosted();
          } catch (e) {
            const msg = 'AIFeed: Instagram Reel failed (' + (reelsOnly ? 'falling back to the carousel' : 'carousel, Story, FB + LinkedIn unaffected') + ')\n' + redact(e.message);
            console.log(msg);
            await sendAlert(msg);
          }
          if (cfg.fbEnabled) {
            try {
              const v = await publishFbVideo(cfg, env, { graphForm }, videoUrl, facebookMessage(reelCaption, qc.story.link), published.post.headline);
              console.log('Facebook video published ' + (v.id || ''));
              fbVideoDone = Boolean(v && v.id);
            } catch (e) { await sendAlert('AIFeed: Facebook Reel video failed\n' + redact(e.message)); }
          }
        } else {
          console.log('Reel rendered + committed; publishing off (reelsPublishEnabled false)');
        }
      } catch (e) {
        const msg = 'AIFeed: Reel failed (' + (reelsOnly ? 'falling back to the carousel' : 'carousel, Story, FB + LinkedIn unaffected') + ')\n' + redact(e.message);
        console.log(msg);
        await sendAlert(msg);
      }
    }

    if (carouselFallback(cfg, reelPublished)) {
      console.log('Reel did not publish: posting the carousel as fallback so the slot is not empty');
      await publishInstagram(cfg, env, slideUrls(), published.igCaption);
      markPosted();
    }

    if (cfg.fbEnabled && !fbPhotoNeeded(cfg, fbVideoDone)) {
      console.log('Facebook photo post skipped (the Reel video was posted to the Page)');
    } else if (fbPhotoNeeded(cfg, fbVideoDone)) {
      try {
        await publishFacebook(cfg, env, published.post.imageUrl, published.igCaption, qc.story.link);
      } catch (e) {
        const msg = 'AIFeed: Facebook Page post failed (Instagram + website unaffected)\n' + redact(e.message);
        console.log(msg);
        await sendAlert(msg);
      }
    } else {
      console.log('Facebook disabled (fbEnabled false)');
    }

    // LinkedIn through Buffer (AIFeed.run page only). A failure only alerts; IG, FB and the site are unaffected.
    if (bufferLinkedinEnabled(cfg, env)) {
      try {
        const storyUrl = cfg.siteUrl + '/news/' + published.slug + '/';
        const post = await bufferLinkedinPost({
          cfg, env,
          text: bufferLinkedinText(published.liCaption, storyUrl),
          imageUrls: [published.post.imageUrl, cfg.endCardUrl],
          videoUrl: published.post.videoUrl || '',
          altText: published.post.headline
        });
        console.log('LinkedIn (Buffer) post created ' + post.id + ' ' + post.status);
      } catch (e) {
        const msg = 'AIFeed: LinkedIn (Buffer) post failed (Instagram, Facebook + website unaffected)\n' + redact(e.message);
        console.log(msg);
        await sendAlert(msg);
      }
    } else if (linkedinEnabled(cfg, env)) {
      try {
        const endRes = await fetch(cfg.endCardUrl, { signal: AbortSignal.timeout(30000) });
        if (!endRes.ok) throw new Error('End card HTTP ' + endRes.status);
        const endCard = Buffer.from(await endRes.arrayBuffer());
        await linkedInPost({
          cfg, env, liCaption: published.liCaption, headline: published.post.headline, feedPng: feed.png, endCard
        });
        console.log('LinkedIn post published');
      } catch (e) {
        const msg = 'AIFeed: LinkedIn post failed (other channels unaffected)\n' + redact(e.message);
        console.log(msg);
        await sendAlert(msg);
      }
    } else {
      console.log('LinkedIn disabled: set the BUFFER_API_KEY secret (bufferLinkedinEnabled + channel id are in config.json)');
    }

    console.log('Autopilot finished slot ' + decision.slot + ' ' + published.slug);
    return 0;
  } catch (e) {
    await release();
    throw e;
  } finally {
    await closeBrowser();
  }
}

if (require.main === module) {
  main().then(code => {
    process.exit(code || 0);
  }).catch(err => {
    console.error(redact(err && err.stack || err));
    process.exit(1);
  });
}

module.exports = { main, runtimeEnv, facebookMessage };
