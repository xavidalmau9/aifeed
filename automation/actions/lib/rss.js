// RSS fetch + cheap dedup. Same feeds, 36h window, AI keyword filter, and prompts as the live n8n node.
const { canonUrl, cheapRepeat, titleSim, siteHistory, igHistory, logHistory, hostOf, decodeEnt, DAY } = require('./dedup');

const FEEDS = [
  'https://techcrunch.com/tag/artificial-intelligence/feed/',
  'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
  'https://venturebeat.com/category/ai/feed/',
  'https://www.wired.com/feed/tag/ai/latest/rss',
  'https://www.technologyreview.com/feed/',
  'https://www.artificialintelligence-news.com/feed/',
  'https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss',
  'https://www.zdnet.com/topic/artificial-intelligence/rss.xml',
  'https://www.cnet.com/rss/ai/',
  'https://www.cnbc.com/id/100727362/device/rss/rss.html',
  'https://9to5google.com/feed/',
  'https://9to5mac.com/feed/',
  'https://arstechnica.com/ai/feed/',
  'https://www.engadget.com/rss.xml',
  'https://news.ycombinator.com/rss'
];
const GENERAL_FROM = 11;
const AI_RE = /\b(ai|a\.i\.|artificial intelligence|gpt|llm|openai|anthropic|gemini|claude|chatgpt|copilot|nvidia|deepmind|mistral|llama|grok|xai|robot|agentic|agent|neural|generative|machine learning)\b/i;

function parseFeed(xml, idx, now = Date.now()) {
  const blocks = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/gi) || String(xml || '').match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const b of blocks.slice(0, 30)) {
    const title = decodeEnt((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const link = ((b.match(/<link[^>]*>\s*(https?:\/\/[^\s<]+)\s*<\/link>/i) || b.match(/<link[^>]+href="(https?:\/\/[^"]+)"/i) || b.match(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/i) || [])[1] || '').trim();
    const dateStr = ((b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || b.match(/<(?:updated|published)[^>]*>([\s\S]*?)<\/(?:updated|published)>/i) || [])[1] || '').trim();
    const desc = decodeEnt(decodeEnt((b.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || b.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] || '')).replace(/\s+/g, ' ').slice(0, 240);
    if (!title || title.length < 20 || !link) continue;
    const ts = dateStr ? new Date(dateStr).getTime() : NaN;
    if (!Number.isNaN(ts) && now - ts > 36 * 3600000) continue;
    if (idx >= GENERAL_FROM && !AI_RE.test(title)) continue;
    out.push({ title, link, desc, publishedAt: Number.isNaN(ts) ? null : new Date(ts).toISOString(), source: hostOf(link) });
  }
  return out;
}

async function fetchFeeds({ fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = 12000 } = {}) {
  const batches = await Promise.all(FEEDS.map(async (url, idx) => {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 AIFeedBot' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      const xml = await res.text();
      return parseFeed(xml, idx, now);
    } catch (e) {
      return [];
    }
  }));
  return batches.flat();
}

function selectFresh(items, allHist) {
  const fresh = [];
  const skipped = [];
  for (const it of items) {
    const cu = canonUrl(it.link);
    const rep = cheapRepeat(it, allHist);
    if (rep) {
      skipped.push({ title: it.title, reason: rep.reason, matched: `[${rep.match.src}] ${rep.match.title}`.slice(0, 140) });
      continue;
    }
    const dup = fresh.find(f => f.canonUrl === cu || titleSim(f.title, it.title).jac >= 0.6);
    if (dup) {
      // Keep the other outlet. If this story's photo is a reused logo, we try theirs.
      if (dup.canonUrl !== cu) {
        dup.alts = dup.alts || [];
        if (dup.alts.length < 4 && !dup.alts.some(a => a.link === it.link)) {
          dup.alts.push({ title: it.title, link: it.link, source: it.source || hostOf(it.link), desc: it.desc || '' });
        }
      }
      continue;
    }
    fresh.push(Object.assign({}, it, { canonUrl: cu, alts: [] }));
    if (fresh.length >= 80) break;
  }
  return { fresh, skipped };
}

function buildPostedCompact(logHist, siteHist, igHist, now = Date.now()) {
  const cutoff = now - 90 * DAY;
  const compact = [];
  const seenC = new Set();
  for (const h of [...logHist, ...siteHist, ...igHist]) {
    const t = h.date ? new Date(h.date).getTime() : NaN;
    if (!Number.isNaN(t) && t < cutoff) continue;
    const key = h.canon || String(h.title || '').toLowerCase();
    if (!h.title || seenC.has(key)) continue;
    seenC.add(key);
    compact.push({
      src: h.src,
      date: Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10),
      title: h.title.slice(0, 140),
      summary: (h.summary || '').slice(0, 140),
      outlet: hostOf(h.url)
    });
    if (compact.length >= 160) break;
  }
  return compact;
}

function buildRankPrompt(fresh, postedCompact) {
  const recentList = postedCompact.slice(0, 60).map(c => '- ' + c.title).join('\n') || '- (none)';
  const list = fresh.map((s, i) => `${i + 1}. ${s.title} (${s.source})`).join('\n');
  return `You are the editor of AIFeed.run, an Instagram + LinkedIn AI news brand.\nRank the best stories below for a broad AI-curious audience. Prefer: major launches, big numbers, policy/legal moves, surprising research, controversy with substance. Reject: opinion pieces, listicles, deals/discount posts, how-tos, rumors, minor updates, non-AI stories.\nMAX 1 story per company and per event.\nSEMANTIC DEDUP: exclude any story that covers the SAME underlying event as anything in "Already posted" even if worded differently or from a different outlet.\n\nAlready posted (most recent first):\n${recentList}\n\nCandidates:\n${list}\n\nReturn ONLY a JSON array (best first, up to 12): [{"index": <candidate number>, "score": <0-100>, "reason": "<short>"}]`;
}

function assembleCandidates({ posts, igMedia, history, items, now = Date.now() }) {
  const hist = history || { posted: [], rankings: {} };
  hist.posted = hist.posted || [];
  hist.rankings = hist.rankings || {};
  const siteHist = siteHistory(posts);
  if (!siteHist.length) {
    throw new Error('Dedupe safety stop: website post history could not be loaded (GitHub API, raw and site JSON all failed) - nothing posted');
  }
  const igHist = igHistory(igMedia);
  const logHist = logHistory(hist);
  const allHist = [...siteHist, ...igHist, ...logHist];
  const { fresh, skipped } = selectFresh(items, allHist);
  if (!fresh.length) throw new Error('No fresh, non-duplicate stories found in RSS feeds - nothing posted');
  const postedCompact = buildPostedCompact(logHist, siteHist, igHist, now);
  return {
    fresh,
    rankPrompt: buildRankPrompt(fresh, postedCompact),
    history: hist,
    postedCompact,
    dedupSkipped: skipped.slice(0, 40),
    historyCounts: { site: siteHist.length, instagram: igHist.length, log: logHist.length },
    dedupStatus: {
      website: 'checkout (' + siteHist.length + ')',
      instagram: igMedia && igMedia.length ? 'ok (' + igMedia.length + ' posts)' : 'FAILED - using website + log only'
    }
  };
}

module.exports = {
  FEEDS, GENERAL_FROM, AI_RE, parseFeed, fetchFeeds, selectFresh, buildPostedCompact, buildRankPrompt, assembleCandidates
};
