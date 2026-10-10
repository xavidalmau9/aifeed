const crypto = require('crypto');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function redact(s) {
  return String(s || '')
    .replace(/access_token=[^&\s]+/gi, 'access_token=REDACTED')
    .replace(/appsecret_proof=[^&\s]+/gi, 'appsecret_proof=REDACTED')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer REDACTED');
}

function appSecretProof(token, appSecret) {
  if (!appSecret) return null;
  return crypto.createHmac('sha256', appSecret).update(token).digest('hex');
}

function withGraphAuth(url, token, appSecret) {
  const u = new URL(url);
  u.searchParams.set('access_token', token);
  const proof = appSecretProof(token, appSecret);
  if (proof) u.searchParams.set('appsecret_proof', proof);
  return u.toString();
}

async function withRetry(fn, tries, waitMs) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (i < tries - 1 && waitMs) await sleep(waitMs);
    }
  }
  throw last;
}

async function claudeVision(apiKey, { model, text, image, mediaType = 'image/jpeg', maxTokens = 300, temperature = 0, tries = 2 }) {
  const data = Buffer.isBuffer(image) ? image.toString('base64') : String(image || '');
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const body = {
        model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text }
          ]
        }]
      };
      if (temperature !== undefined) body.temperature = temperature;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('Anthropic HTTP ' + res.status + ' ' + JSON.stringify(json).slice(0, 300));
      const out = json.content && json.content[0] && json.content[0].text;
      if (!out) throw new Error('Anthropic response had no text');
      return out;
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(5000);
    }
  }
  throw last;
}

async function claudeMessage(apiKey, { model, prompt, maxTokens, temperature, tries = 3 }) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
      if (temperature !== undefined) body.temperature = temperature;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('Anthropic HTTP ' + res.status + ' ' + JSON.stringify(json).slice(0, 300));
      const text = json.content && json.content[0] && json.content[0].text;
      if (!text) throw new Error('Anthropic response had no text');
      return text;
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(5000);
    }
  }
  throw last;
}

async function graphForm(url, fields, { token, appSecret, tries = 1, waitMs = 0 }) {
  return withRetry(async () => {
    const res = await fetch(withGraphAuth(url, token, appSecret), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(60000)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      throw new Error('Graph HTTP ' + res.status + ' ' + JSON.stringify(json.error || json).slice(0, 400));
    }
    return json;
  }, tries, waitMs);
}

async function graphGet(url, { token, appSecret }) {
  const res = await fetch(withGraphAuth(url, token, appSecret), { signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error('Graph HTTP ' + res.status + ' ' + JSON.stringify(json.error || json).slice(0, 400));
  }
  return json;
}

async function fetchIgMedia(cfg, env) {
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.igUserId}/media`;
  const json = await withRetry(async () => {
    const u = new URL(withGraphAuth(url, env.META_PAGE_TOKEN, env.META_APP_SECRET));
    u.searchParams.set('fields', 'caption,timestamp');
    u.searchParams.set('limit', '100');
    const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error('Graph HTTP ' + res.status + ' ' + JSON.stringify(body.error || body).slice(0, 300));
    return body;
  }, 2, 5000);
  return Array.isArray(json.data) ? json.data : [];
}

async function pollContainer(cfg, env, creationId, { waitMs, maxAttempts, label }) {
  const base = `https://graph.facebook.com/${cfg.graphVersion}/${creationId}`;
  const auth = { token: env.META_PAGE_TOKEN, appSecret: env.META_APP_SECRET };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(waitMs);
    const json = await graphGet(base + '?fields=status_code,status', auth);
    const s = json.status_code;
    if (s === 'ERROR' || s === 'EXPIRED') throw new Error(`${label} container ${s}: ${json.status || ''}`);
    if (s === 'FINISHED') return json;
    if (attempt >= maxAttempts) throw new Error(`${label} not FINISHED after ${attempt} polls (last: ${s})`);
  }
}

async function pollPublic(url, { firstWaitMs = 60000, retryWaitMs = 30000, maxAttempts = 9, sleepFn = sleep } = {}) {
  await sleepFn(firstWaitMs);
  let last = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleepFn(retryWaitMs);
    let status = 0;
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(20000)
      });
      status = res.status;
      await res.arrayBuffer().catch(() => {});
    } catch (e) {
      status = 0;
    }
    last = status;
    if (status === 200) return;
    if (attempt >= maxAttempts) throw new Error('Image URL still not public after ~5 min (HTTP ' + status + ')');
  }
  throw new Error('Image URL still not public after ~5 min (HTTP ' + last + ')');
}

function escapeLinkedIn(text) {
  return String(text || '').replace(/[\\(){}\[\]<>@|~_*#]/g, m => '\\' + m);
}

function linkedinEnabled(cfg, env) {
  if (!cfg.linkedinEnabled) return false;
  if (!/^urn:li:(person|organization):[A-Za-z0-9_-]+$/.test(cfg.linkedinAuthorUrn || '')) return false;
  if (!env.LINKEDIN_ACCESS_TOKEN) return false;
  return true;
}

async function linkedInPost({ cfg, env, liCaption, headline, feedPng, endCard }) {
  const token = env.LINKEDIN_ACCESS_TOKEN;
  const headers = {
    Authorization: 'Bearer ' + token,
    'LinkedIn-Version': String(cfg.linkedinVersion || '202509'),
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json'
  };
  async function init() {
    const res = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
      method: 'POST',
      headers,
      body: JSON.stringify({ initializeUploadRequest: { owner: cfg.linkedinAuthorUrn } }),
      signal: AbortSignal.timeout(30000)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.value) throw new Error('LinkedIn init HTTP ' + res.status + ' ' + JSON.stringify(json).slice(0, 300));
    return json.value;
  }
  async function upload(uploadUrl, buf) {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
      body: buf,
      signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) throw new Error('LinkedIn upload HTTP ' + res.status);
  }
  const story = await init();
  await upload(story.uploadUrl, feedPng);
  const card = await init();
  await upload(card.uploadUrl, endCard);
  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      author: cfg.linkedinAuthorUrn,
      commentary: escapeLinkedIn(liCaption),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: {
        multiImage: {
          images: [
            { id: story.image, altText: headline },
            { id: card.image, altText: 'Follow AIFeed.run - AI News Delivered by AI' }
          ]
        }
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('LinkedIn post HTTP ' + res.status + ' ' + t.slice(0, 300));
  }
}

module.exports = {
  sleep, redact, appSecretProof, withGraphAuth, withRetry, claudeMessage, claudeVision, graphForm, graphGet,
  fetchIgMedia, pollContainer, pollPublic, escapeLinkedIn, linkedinEnabled, linkedInPost
};
