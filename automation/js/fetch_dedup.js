// Loads the FULL posted history (website + Instagram + workflow log), fetches RSS, and removes anything
// already posted (same normalized source URL or similar title). A semantic same-event check runs later.
// (dedup_lib.js is prepended by build.py)
const cfg = $('Config').first().json;
const decode64 = r => { try { return r && r.content ? JSON.parse(Buffer.from(r.content, 'base64').toString('utf8')) : null; } catch (e) { return null; } };
const histResp = $('GH Get History').first().json || {};
const postsResp = $('GH Get Posts Index').first().json || {};
const history = decode64(histResp) || { posted: [], rankings: {} };
history.posted = history.posted || []; history.rankings = history.rankings || {};
const status = { website: null, instagram: null, log: history.posted.length };
const bust = u => u + (u.includes('?') ? '&' : '?') + 't=' + Date.now();

// (a) Website history (posts-index.json = every story on aifeed.run): GitHub API -> download_url (files >1MB have no
// inline content) -> raw.githubusercontent -> live site JSON, each tried twice.
let posts = decode64(postsResp);
let siteHist = null;
if (Array.isArray(posts) && posts.length) { siteHist = siteHistory(posts); status.website = 'github-api (' + posts.length + ')'; }
else {
  posts = null;
  const urls = [postsResp.download_url, `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/_posts/posts-index.json`, cfg.siteUrl + '/_posts/posts-index.json'].filter(Boolean);
  outer: for (const u of urls) for (let t = 0; t < 2; t++) {
    try {
      const r = await this.helpers.httpRequest({ method: 'GET', url: bust(u), timeout: 20000 });
      const arr = typeof r === 'string' ? JSON.parse(r) : r;
      if (Array.isArray(arr) && arr.length) { posts = arr; siteHist = siteHistory(arr); status.website = hostOf(u) + ' (' + arr.length + ')'; break outer; }
    } catch (e) { /* retry / next source */ }
  }
}
// Safety rule: never post unless the website history loaded.
if (!siteHist || !siteHist.length) throw new Error('Dedupe safety stop: website post history could not be loaded (GitHub API, raw and site JSON all failed) - nothing posted');

// (b) Instagram captions (HTTP node retries once; on failure we continue with website + log only).
let igHist = [];
try {
  const media = $('IG Get Recent Media').all().flatMap(i => (i.json && Array.isArray(i.json.data)) ? i.json.data : []);
  igHist = igHistory(media);
  status.instagram = media.length ? 'ok (' + media.length + ' posts)' : 'FAILED - using website + log only';
} catch (e) { status.instagram = 'FAILED - using website + log only'; }

// (c) workflow's own posted log
const logHist = logHistory(history);
const allHist = [...siteHist, ...igHist, ...logHist];

const FEEDS = ['https://techcrunch.com/tag/artificial-intelligence/feed/','https://www.theverge.com/rss/ai-artificial-intelligence/index.xml','https://venturebeat.com/category/ai/feed/','https://www.wired.com/feed/tag/ai/latest/rss','https://www.technologyreview.com/feed/','https://www.artificialintelligence-news.com/feed/','https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss','https://www.zdnet.com/topic/artificial-intelligence/rss.xml','https://www.cnet.com/rss/ai/','https://www.cnbc.com/id/100727362/device/rss/rss.html','https://9to5google.com/feed/','https://9to5mac.com/feed/','https://arstechnica.com/ai/feed/','https://www.engadget.com/rss.xml','https://news.ycombinator.com/rss'];
const GENERAL_FROM = 11; // feeds from this index need an AI keyword filter
const AI_RE = /\b(ai|a\.i\.|artificial intelligence|gpt|llm|openai|anthropic|gemini|claude|chatgpt|copilot|nvidia|deepmind|mistral|llama|grok|xai|robot|agentic|agent|neural|generative|machine learning)\b/i;

async function feed(url, idx) {
  try {
    const raw = await this.helpers.httpRequest({ method: 'GET', url, timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 AIFeedBot' } });
    const xml = typeof raw === 'string' ? raw : String(raw?.body || raw || '');
    const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    const out = [];
    for (const b of blocks.slice(0, 30)) {
      const title = decodeEnt((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const link = ((b.match(/<link[^>]*>\s*(https?:\/\/[^\s<]+)\s*<\/link>/i) || b.match(/<link[^>]+href="(https?:\/\/[^"]+)"/i) || b.match(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/i) || [])[1] || '').trim();
      const dateStr = ((b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || b.match(/<(?:updated|published)[^>]*>([\s\S]*?)<\/(?:updated|published)>/i) || [])[1] || '').trim();
      const desc = decodeEnt(decodeEnt((b.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || b.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] || '')).replace(/\s+/g, ' ').slice(0, 240);
      if (!title || title.length < 20 || !link) continue;
      const ts = dateStr ? new Date(dateStr).getTime() : NaN;
      if (!isNaN(ts) && Date.now() - ts > 36 * 3600000) continue;
      if (idx >= GENERAL_FROM && !AI_RE.test(title)) continue;
      out.push({ title, link, desc, publishedAt: isNaN(ts) ? null : new Date(ts).toISOString(), source: hostOf(link) });
    }
    return out;
  } catch (e) { return []; }
}
const res = await Promise.allSettled(FEEDS.map((u, i) => feed.call(this, u, i)));
const all = res.flatMap(r => r.status === 'fulfilled' ? r.value : []);

const fresh = [], skipped = [];
for (const it of all) {
  const cu = canonUrl(it.link);
  const rep = cheapRepeat(it, allHist);
  if (rep) { skipped.push({ title: it.title, reason: rep.reason, matched: `[${rep.match.src}] ${rep.match.title}`.slice(0, 140) }); continue; }
  if (fresh.some(f => f.canonUrl === cu || titleSim(f.title, it.title).jac >= 0.6)) continue;  // dedup inside this batch
  fresh.push({ ...it, canonUrl: cu });
  if (fresh.length >= 80) break;
}
if (!fresh.length) throw new Error('No fresh, non-duplicate stories found in RSS feeds - nothing posted');

// Compact "already posted" list for the ranking prompt and the semantic same-event check (last 90 days, site + IG + log).
const cutoff = Date.now() - 90 * DAY;
const compact = [];
const seenC = new Set();
for (const h of [...logHist, ...siteHist, ...igHist]) {
  const t = h.date ? new Date(h.date).getTime() : NaN;
  if (!isNaN(t) && t < cutoff) continue;
  const key = h.canon || h.title.toLowerCase();
  if (!h.title || seenC.has(key)) continue;
  seenC.add(key);
  compact.push({ src: h.src, date: isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10), title: h.title.slice(0, 140), summary: (h.summary || '').slice(0, 140), outlet: hostOf(h.url) });
  if (compact.length >= 160) break;
}
const recentList = compact.slice(0, 60).map(c => '- ' + c.title).join('\n') || '- (none)';
const list = fresh.map((s, i) => `${i + 1}. ${s.title} (${s.source})`).join('\n');
const rankPrompt = `You are the editor of AIFeed.run, an Instagram + LinkedIn AI news brand.\nRank the best stories below for a broad AI-curious audience. Prefer: major launches, big numbers, policy/legal moves, surprising research, controversy with substance. Reject: opinion pieces, listicles, deals/discount posts, how-tos, rumors, minor updates, non-AI stories.\nMAX 1 story per company and per event.\nSEMANTIC DEDUP: exclude any story that covers the SAME underlying event as anything in "Already posted" even if worded differently or from a different outlet.\n\nAlready posted (most recent first):\n${recentList}\n\nCandidates:\n${list}\n\nReturn ONLY a JSON array (best first, up to 12): [{"index": <candidate number>, "score": <0-100>, "reason": "<short>"}]`;
return [{ json: { fresh, rankPrompt, history, historySha: histResp.sha || null, posts, postsSha: postsResp.sha || null, postedCompact: compact, dedupStatus: status, dedupSkipped: skipped.slice(0, 40), historyCounts: { site: siteHist.length, instagram: igHist.length, log: logHist.length } } }];
