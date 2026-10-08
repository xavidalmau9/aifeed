#!/usr/bin/env node
// AIFeed autopilot: same story selection, captions, graphics, and Instagram carousel as the live n8n workflow.
// Dry run renders and writes files under OUT_DIR and does not claim, commit, or post.
const fs = require('fs');
const path = require('path');
const { decideRun } = require('./lib/schedule');
const { CLAIM_PATH, evaluateClaim, updateClaimDoc, SlotTaken } = require('./lib/claim');
const { fetchFeeds, assembleCandidates } = require('./lib/rss');
const { orderPool, buildSameEventPrompt, applySameEvent } = require('./lib/pick');
const { fetchArticles } = require('./lib/articles');
const { parseModelArray, runQuality, applyAccuracyFix, layoutErrors, mergeLiCaption, assemblePublish, mergeHistory } = require('./lib/quality');
const { sourceCheckAll, verifyCandidate, checkLiExpansion } = require('./lib/factcheck');
const { assertFeedPng, assertStoryPng } = require('./lib/png');
const { renderHtml, closeBrowser } = require('./render');
const { readJson, writeJson, commitApply, git } = require('./lib/git');
const {
  claudeMessage, fetchIgMedia, graphForm, graphGet, pollContainer, pollPublic, linkedinEnabled, linkedInPost, redact
} = require('./lib/net');
const { sendAlert } = require('./alert');
const { buildFb, checkFb } = require('./lib/captions');

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

async function publishInstagram(cfg, env, imageUrl, caption) {
  const auth = { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
  const base = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.igUserId}`;
  const child1 = await graphForm(base + '/media', { image_url: imageUrl, is_carousel_item: 'true' }, Object.assign({ tries: 3, waitMs: 15000 }, auth));
  const child2 = await graphForm(base + '/media', { image_url: cfg.endCardUrl, is_carousel_item: 'true' }, Object.assign({ tries: 3, waitMs: 15000 }, auth));
  if (!child1.id || !child2.id) throw new Error('Instagram did not return carousel child ids');
  const carousel = await graphForm(base + '/media', {
    media_type: 'CAROUSEL',
    children: child1.id + ',' + child2.id,
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
  const decision = decideRun({ now: new Date(), eventName: env.EVENT_NAME, slotInput: env.SLOT });
  console.log(decision.reason);
  if (!decision.run) return 0;

  if (process.env.GITHUB_ACTIONS === 'true') syncMain(env.REPO);

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
    const dropped = applySameEvent(ordered.pool, assembled.postedCompact, sameText);
    console.log('Same-event kept ' + dropped.candidates.length + ', skipped ' + dropped.sameEventSkipped.length);
    dropped.sameEventSkipped.forEach(s => console.log('  same-event skip: ' + s.title + ' => ' + (s.matched || s.reason)));

    const articles = await fetchArticles(dropped.candidates);
    articles.usable.filter(c => !c.photoOk).forEach(c => console.log('  photo skip: ' + c.title + ' (' + c.photoProblem + ')'));
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
    console.log('Image: ' + published.pngName);

    if (env.DRY_RUN) {
      console.log('Rendering story graphic for dry-run artifacts');
      const story = await renderHtml(qc.storyHtml, { width: 1080, height: 1920, waitMs: 3000 });
      assertStoryPng(story.png);
      fs.mkdirSync(env.OUT, { recursive: true });
      fs.writeFileSync(path.join(env.OUT, published.pngName), feed.png);
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
        sameEventSkipped: dropped.sameEventSkipped,
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
      console.log('DRY RUN complete. Nothing was posted or committed. Artifacts: ' + env.OUT);
      return 0;
    }

    contentCommitted = true;
    const headline = published.post.headline;
    commitApply(env.REPO, 'Publish: ' + headline.substring(0, 60), () => {
      const freshPosts = readJson(env.REPO, '_posts/posts-index.json', []);
      const freshHist = readJson(env.REPO, '_data/history.json', { posted: [], rankings: {} });
      const imageRel = 'images/' + published.pngName;
      fs.mkdirSync(path.join(env.REPO, 'images'), { recursive: true });
      fs.writeFileSync(path.join(env.REPO, imageRel), feed.png);
      const nextPosts = freshPosts.some(p => p && p.id === published.post.id) ? freshPosts : [published.post, ...freshPosts];
      writeJson(env.REPO, '_posts/posts-index.json', nextPosts);
      writeJson(env.REPO, '_data/history.json', mergeHistory(freshHist, {
        entry: published.historyEntry,
        rankings: ordered.rankings
      }));
      return [imageRel, '_posts/posts-index.json', '_data/history.json'];
    });
    console.log('Committed feed image, posts index, and history');

    console.log('Waiting for ' + published.post.imageUrl);
    await pollPublic(published.post.imageUrl);
    await publishInstagram(cfg, env, published.post.imageUrl, published.igCaption);
    try { writeClaim(env, decision, 'posted', { extra: { slug: published.slug, image: published.pngName } }); }
    catch (e) { console.log('Could not mark claim posted: ' + redact(e.message)); }

    try {
      console.log('Rendering Instagram story');
      const story = await renderHtml(qc.storyHtml, { width: 1080, height: 1920, waitMs: 3000 });
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

    if (cfg.fbEnabled) {
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

    if (linkedinEnabled(cfg, env)) {
      const endRes = await fetch(cfg.endCardUrl, { signal: AbortSignal.timeout(30000) });
      if (!endRes.ok) throw new Error('End card HTTP ' + endRes.status);
      const endCard = Buffer.from(await endRes.arrayBuffer());
      await linkedInPost({
        cfg, env, liCaption: published.liCaption, headline: published.post.headline, feedPng: feed.png, endCard
      });
      console.log('LinkedIn post published');
    } else {
      console.log('LinkedIn disabled until linkedinEnabled is true, the author URN is real, and LINKEDIN_ACCESS_TOKEN is set');
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
