// One-off "redo a post" runner. Only runs from pipeline.js on a manual workflow_dispatch when
// _data/repost-request.json exists with status "pending" (scheduled runs never use it).
// Publishes the corrected graphic with the IDENTICAL caption of the post it replaces, then deletes
// the old post(s), logs the result to _data/repost-log.json and removes the request file.
const fs = require('fs');
const path = require('path');
const { graphGet, withGraphAuth, pollPublic, redact } = require('./lib/net');
const { commitApply, readJson, writeJson } = require('./lib/git');
const { checkIg, checkFb } = require('./lib/captions');

const REQ = '_data/repost-request.json';
const LOG = '_data/repost-log.json';

async function graphDelete(url, auth) {
  const res = await fetch(withGraphAuth(url, auth.token, auth.appSecret), { method: 'DELETE', signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error('Graph HTTP ' + res.status + ' ' + JSON.stringify(json.error || json).slice(0, 300));
  return json;
}

// Only a PENDING request diverts a manual run. A failed/stuck one never blocks the normal 8am/5pm post.
function hasRequest(repo) {
  const req = readJson(repo, REQ, null);
  return !!(req && req.status === 'pending');
}

async function runRepost(cfg, env, P) {
  const req = readJson(env.REPO, REQ, null);
  if (!req || req.status !== 'pending') { console.log('Repost request is not pending (' + (req && req.status) + '); nothing done'); return 0; }
  commitApply(env.REPO, 'Repost: start ' + req.slug, () => { writeJson(env.REPO, REQ, Object.assign({}, req, { status: 'running', startedAt: new Date().toISOString() })); return [REQ]; });
  const auth = { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
  const G = `https://graph.facebook.com/${cfg.graphVersion}/`;
  const out = { slug: req.slug, at: new Date().toISOString(), old: req.old, deleted: {} };

  // Current state first: an earlier attempt must not lead to a double post or double delete.
  const igList = (await graphGet(G + cfg.igUserId + '/media?fields=id,caption,media_type,timestamp,permalink&limit=8', auth)).data || [];
  const fbList = (await graphGet(G + cfg.fbPageId + '/published_posts?fields=id,message,created_time,permalink_url&limit=8', auth)).data || [];
  let storyList = [];
  try { storyList = (await graphGet(G + cfg.igUserId + '/stories?fields=id,timestamp,permalink', auth)).data || []; } catch (e) { console.log('stories list failed ' + redact(e.message)); }
  console.log('STATE IG media: ' + JSON.stringify(igList.map(m => [m.id, m.timestamp, m.media_type, m.permalink, String(m.caption || '').slice(0, 50)])));
  console.log('STATE FB posts: ' + JSON.stringify(fbList.map(m => [m.id, m.created_time, m.permalink_url, String(m.message || '').slice(0, 50)])));
  console.log('STATE IG stories: ' + JSON.stringify(storyList.map(m => [m.id, m.timestamp])));
  const oldIg = igList.find(m => m.id === req.old.igMediaId);
  if (!oldIg) throw new Error('old Instagram post ' + req.old.igMediaId + ' is not in the recent media list (already deleted?) - stop, nothing posted');
  const caption = String(oldIg.caption || '');
  if (!caption) throw new Error('old Instagram caption is empty - stop');
  const already = igList.find(m => m.id !== oldIg.id && String(m.caption || '') === caption);
  if (already) throw new Error('a post with the same caption already exists (' + already.permalink + ') - an earlier repost went out; stop');
  out.oldIgPermalink = oldIg.permalink;
  const igErr = checkIg(caption, req.sourceUrl);
  console.log('Old IG caption read (' + caption.length + ' chars), layout check: ' + (igErr.length ? igErr.join('; ') : 'ok'));
  if (igErr.length) throw new Error('caption fails the Instagram layout check - stop');
  let fbMessage = '';
  if (req.old.fbPostId) {
    const oldFb = fbList.find(m => m.id === req.old.fbPostId);
    if (!oldFb) throw new Error('old Facebook post ' + req.old.fbPostId + ' is not in published_posts - stop, nothing posted');
    fbMessage = String(oldFb.message || '');
    if (fbList.some(m => m.id !== oldFb.id && String(m.message || '') === fbMessage)) throw new Error('a Facebook post with the same message already exists - stop');
    out.oldFbPermalink = oldFb.permalink_url;
    const fbErr = checkFb(fbMessage, req.sourceUrl);
    console.log('Old FB message read (' + fbMessage.length + ' chars), layout check: ' + (fbErr.length ? fbErr.join('; ') : 'ok'));
    if (fbErr.length) throw new Error('message fails the Facebook layout check - stop');
  }
  if (req.old.igStoryId && !storyList.some(m => m.id === req.old.igStoryId)) console.log('old story ' + req.old.igStoryId + ' is not in the live stories list');

  const feedUrl = cfg.siteUrl + '/images/' + req.feedImage;
  const storyUrl = req.storyImage ? cfg.siteUrl + '/images/' + req.storyImage : '';
  await pollPublic(feedUrl, { firstWaitMs: 0 });
  if (storyUrl) await pollPublic(storyUrl, { firstWaitMs: 0 });

  const ig = await P.publishInstagram(cfg, env, feedUrl, caption);
  out.igId = ig.id;
  try { out.igPermalink = (await graphGet(G + ig.id + '?fields=permalink', auth)).permalink; } catch (e) { console.log('permalink lookup failed ' + redact(e.message)); }
  if (storyUrl) {
    try { out.storyId = (await P.publishStory(cfg, env, storyUrl)).id; } catch (e) { console.log('STORY FAILED: ' + redact(e.message)); }
  }
  if (fbMessage) {
    try {
      const base = G + cfg.fbPageId;
      const { graphForm } = require('./lib/net');
      const p1 = await graphForm(base + '/photos', { url: feedUrl, published: 'false' }, Object.assign({ tries: 2, waitMs: 5000 }, auth));
      const p2 = await graphForm(base + '/photos', { url: cfg.endCardUrl, published: 'false' }, Object.assign({ tries: 2, waitMs: 5000 }, auth));
      const post = await graphForm(base + '/feed', { message: fbMessage, attached_media: JSON.stringify([{ media_fbid: p1.id }, { media_fbid: p2.id }]) }, auth);
      out.fbId = post.id;
      try { out.fbPermalink = (await graphGet(G + post.id + '?fields=permalink_url', auth)).permalink_url; } catch (e) {}
      console.log('Facebook post published ' + post.id);
    } catch (e) { console.log('FB FAILED: ' + redact(e.message)); }
  }

  // Delete the old posts only after the replacements are live.
  const targets = [['igMediaId', out.igId], ['igStoryId', out.storyId], ['fbPostId', out.fbId]];
  for (const [k, replaced] of targets) {
    const id = req.old[k];
    if (!id) continue;
    if (!replaced) { out.deleted[k] = 'kept (replacement not published)'; continue; }
    try { await graphDelete(G + id, auth); out.deleted[k] = 'deleted'; } catch (e) { out.deleted[k] = 'FAILED: ' + redact(e.message).slice(0, 200); }
    console.log('delete ' + k + ' ' + id + ': ' + out.deleted[k]);
  }
  console.log('REPOST RESULT ' + JSON.stringify(out));
  commitApply(env.REPO, 'Repost: done ' + req.slug, () => {
    const log = readJson(env.REPO, LOG, []);
    log.push(out);
    writeJson(env.REPO, LOG, log);
    fs.rmSync(path.join(env.REPO, REQ), { force: true });
    return [LOG, REQ];
  });
  return 0;
}

module.exports = { hasRequest, runRepost };
