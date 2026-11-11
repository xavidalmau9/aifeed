const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { articleIsLive, articlePublicUrl } = require('../lib/articlelive');
const { ARTICLE_WAIT, pollArticle, cacheBust } = require('../lib/net');

const SLUG = 'how-ai-security-failures-are-endangering';
const HEAD = "How AI security failures are endangering your supply chain";

function storyHtml(slug, headline) {
  const esc = headline.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  return `<title>${esc} | AIFeed.run AI News</title>`
    + `<link rel="canonical" href="https://aifeed.run/news/${slug}/" />`
    + `<script>window.__AIFEED_SLUG = ${JSON.stringify(slug)};</script>`
    + `<article class="seo-static"><h1>${esc}</h1></article>`;
}

const NOT_FOUND = '<title>Page not found | AIFeed.run AI News</title><h1>Page not found</h1>'
  + '<p>That URL is not on AIFeed.run AI News.</p>';

test('article URL is the public story path', () => {
  assert.equal(articlePublicUrl('https://aifeed.run', SLUG), 'https://aifeed.run/news/' + SLUG + '/');
  assert.equal(articlePublicUrl('https://aifeed.run/', SLUG), 'https://aifeed.run/news/' + SLUG + '/');
});

test('HTTP 200 is the story only when the body is that article, not the 404 page', () => {
  assert.equal(articleIsLive(200, storyHtml(SLUG, HEAD), { slug: SLUG, headline: HEAD }), true);
  assert.equal(articleIsLive(200, NOT_FOUND, { slug: SLUG, headline: HEAD }), false);
  assert.equal(articleIsLive(404, storyHtml(SLUG, HEAD), { slug: SLUG, headline: HEAD }), false);
  assert.equal(articleIsLive(200, storyHtml('other-slug', HEAD), { slug: SLUG, headline: HEAD }), false);
  assert.equal(articleIsLive(200, '', { slug: SLUG, headline: HEAD }), false);
  const quoted = "OpenAI's model";
  assert.equal(articleIsLive(200, storyHtml(SLUG, quoted), { slug: SLUG, headline: quoted }), true);
});

test('article wait is about 10 to 12 minutes', () => {
  const total = ARTICLE_WAIT.firstWaitMs + ARTICLE_WAIT.retryWaitMs * (ARTICLE_WAIT.maxAttempts - 1);
  assert.ok(total >= 10 * 60000 && total <= 12 * 60000, 'total ' + total);
  assert.equal(ARTICLE_WAIT.retryWaitMs, 30000);
});

test('pollArticle busts the cache and keeps going while the 404 page is served', async () => {
  const url = articlePublicUrl('https://aifeed.run', SLUG);
  let calls = 0;
  const seen = [];
  const fetchFn = async (got, opts) => {
    calls += 1;
    seen.push({ got, cache: opts.headers['cache-control'], pragma: opts.headers.pragma, store: opts.cache });
    const live = calls >= 3;
    return {
      status: live ? 200 : 404,
      text: async () => (live ? storyHtml(SLUG, HEAD) : NOT_FOUND)
    };
  };
  let slept = 0;
  const result = await pollArticle(url, {
    slug: SLUG,
    headline: HEAD,
    firstWaitMs: 0,
    retryWaitMs: 30000,
    maxAttempts: 5,
    sleepFn: async ms => { slept += ms; },
    fetchFn
  });
  assert.equal(result.status, 200);
  assert.equal(result.attempt, 3);
  assert.equal(calls, 3);
  assert.equal(slept, 60000);
  assert.ok(seen.every(s => s.got.startsWith(url + '?aifeed_live=') || s.got.includes('aifeed_live=')));
  assert.ok(seen.every(s => s.cache === 'no-cache' && s.pragma === 'no-cache' && s.store === 'no-store'));
  assert.ok(cacheBust(url, 5).includes('aifeed_live=5'));
});

test('a 200 response that is still the 404 page does not count as live', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    const live = calls >= 2;
    return { status: 200, text: async () => (live ? storyHtml(SLUG, HEAD) : NOT_FOUND) };
  };
  const result = await pollArticle(articlePublicUrl('https://aifeed.run', SLUG), {
    slug: SLUG, headline: HEAD, firstWaitMs: 0, retryWaitMs: 1, maxAttempts: 4,
    sleepFn: async () => {}, fetchFn
  });
  assert.equal(result.attempt, 2);
});

test('pollArticle stops without posting when the story never appears', async () => {
  const fetchFn = async () => ({ status: 404, text: async () => NOT_FOUND });
  await assert.rejects(
    () => pollArticle(articlePublicUrl('https://aifeed.run', SLUG), {
      slug: SLUG, headline: HEAD, firstWaitMs: 0, retryWaitMs: 1, maxAttempts: 2,
      sleepFn: async () => {}, fetchFn
    }),
    /Article URL not live after ~0 min \(HTTP 404\).*Not posting a link to a page that is not on AIFeed\.run/
  );
});

test('social posts wait for the article, and a miss releases the slot for the retry', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '../pipeline.js'), 'utf8');
  const at = s => pipeline.indexOf(s);
  const gate = at('await pollArticle(articleUrl');
  assert.ok(gate > at("contentCommitted = true"));
  for (const call of [
    'await publishInstagram(',
    'await publishStory(',
    'await publishIgReel(',
    'await publishFbVideo(',
    'await publishFacebook(',
    'await bufferLinkedinPost(',
    'await linkedInPost('
  ]) {
    assert.ok(gate < at(call), call + ' must follow the article check');
  }
  assert.ok(at('releaseUnpublishedSlot(') > gate);
  assert.match(pipeline, /Released slot .* because the article page was not live on AIFeed\.run/);
  assert.doesNotMatch(pipeline.slice(gate, gate + 1200), /\bdaily\b/i);
  const pages = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/pages.yml'), 'utf8');
  assert.match(pages, /cancel-in-progress:\s*false/);
  assert.match(pages, /Prune push rejected \(main moved\)/);
  assert.match(pages, /Deploying origin\/main so the article page is not left unpublished/);
  assert.match(pages, /id: staged/);
  assert.match(pages, /sha: \$\{\{ steps\.staged\.outputs\.sha \}\}/);
  assert.match(pages, /Skipping Pages deploy/);
  assert.match(pages, /Fail only when this commit is still unpublished/);
  assert.doesNotMatch(pages, /git push origin HEAD:main\n/);
});
