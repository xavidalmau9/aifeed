// Quality gate, accuracy retry, layout re-check, LinkedIn merge, and the publish payload.
// Same acceptance rules as the live n8n Quality Checks / Layout Check / Merge LI / Prep Commits nodes.
const { buildIg, buildLi, checkIg, checkLi, checkAccuracy, normText } = require('./captions');
const { buildGraphics } = require('./html');

const CATS = ['BUSINESS', 'MODELS', 'TOOLS', 'RESEARCH', 'POLICY', 'HARDWARE', 'SAFETY'];
const words = s => String(s || '').split(/\s+/).filter(Boolean).length;

function parseModelArray(text) {
  return JSON.parse((String(text).replace(/```json|```/g, '').match(/\[[\s\S]*\]/) || ['[]'])[0]);
}

function applyAccuracyFix(gen, { fixText, accuracyCandidate }) {
  let fixNote = null;
  try {
    const fix = JSON.parse((String(fixText || '').replace(/```json|```/g, '').match(/\{[\s\S]*\}/) || ['{}'])[0]);
    const i = gen.findIndex(x => x.candidate === accuracyCandidate);
    if (i >= 0 && fix && fix.graphicHeadline) {
      gen[i] = Object.assign({}, gen[i], fix, { candidate: accuracyCandidate });
      fixNote = 'accuracy regenerated for candidate ' + accuracyCandidate;
    } else fixNote = 'accuracy regeneration unusable - falling back';
  } catch (e) {
    fixNote = 'accuracy regeneration unparseable - falling back';
  }
  return fixNote;
}

function accuracyFixPrompt(acc, c, g) {
  return `Rewrite the AIFeed.run copy below so it is strictly accurate to the source. Problems found: ${acc.join('; ')}.
RULES: keep every hedge from the source (considers, plans, reportedly, in talks, sources say, may, up to, expected to...). Never state a report, plan, proposal or rumor as done. Use ONLY facts in the source text; invent nothing (no "strong demand", no outcomes, no numbers that are not there). Keep currency symbols and units exactly: write $15B or $15 billion, never "15 BILLION".
SOURCE TITLE: ${c.title}
SOURCE DESCRIPTION: ${c.desc || c.description || ''}
SOURCE TEXT (truncated): ${c.text}
CURRENT COPY: ${JSON.stringify({ graphicHeadline: g.graphicHeadline, highlightWords: g.highlightWords, summary: g.summary, igHook: g.igHook, igParagraphs: g.igParagraphs, liHook: g.liHook, liParagraphs: g.liParagraphs, liTakeaway: g.liTakeaway })}
Return ONLY one JSON object with the same keys: graphicHeadline (ALL CAPS, 4-8 words, max 60 chars, MUST contain a hedge word such as WEIGHS, MULLS, PLANS, EYES, IN TALKS, MAY, UP TO, REPORTEDLY when the source is hedged), highlightWords (1-3), summary (1 sentence, 14-26 words, hedged), igHook (starts with one emoji, max 18 words, hedged), igParagraphs (3-4 paragraphs, 15-45 words each, no emojis), liHook, liParagraphs (5), liTakeaway.`;
}

function runQuality({ usable, captionText, fixPass = false, fixText = '', accuracyCandidate = null }) {
  let gen;
  try { gen = parseModelArray(captionText); } catch (e) {
    throw new Error('Caption JSON parse failed: ' + String(captionText || '').slice(0, 200));
  }
  let fixNote = null;
  if (fixPass) fixNote = applyAccuracyFix(gen, { fixText, accuracyCandidate });
  const failures = [];
  let pick = null;
  for (const g of gen) {
    const c = usable[g.candidate];
    const problems = [];
    if (!c) problems.push('bad candidate index');
    if (!g.supported) problems.push('fact check: ' + (g.issues || 'unsupported'));
    if (!g.safe) problems.push('safety');
    if (c) {
      g.igCaption = buildIg(g, c.link);
      g.liCaption = buildLi(g, c.link);
      checkIg(g.igCaption, c.link).forEach(x => problems.push('IG layout: ' + x));
      g.liLayoutWarnings = checkLi(g.liCaption);
    }
    const acc = c ? checkAccuracy(g, c) : [];
    const hw = words(g.graphicHeadline);
    if (hw < 3 || hw > 9 || String(g.graphicHeadline).length > 60) problems.push('graphic headline length');
    if (words(g.summary) > 30) problems.push('summary too long');
    if (!problems.length && acc.length && !fixPass) {
      return {
        accuracyRetry: true,
        accuracyCandidate: g.candidate,
        accuracyProblems: acc,
        accuracyPrompt: accuracyFixPrompt(acc, c, g)
      };
    }
    acc.forEach(x => problems.push('accuracy: ' + x));
    if (problems.length) {
      failures.push(`${c ? c.title.slice(0, 60) : '?'}: ${problems.join('; ')}`);
      continue;
    }
    pick = { c, g };
    break;
  }
  if (!pick) throw new Error('No candidate passed quality checks → ' + failures.join(' | '));
  const { c, g } = pick;
  g.summary = normText(g.summary);
  g.graphicHeadline = normText(g.graphicHeadline).toUpperCase();
  const category = CATS.includes(String(g.category).toUpperCase()) ? String(g.category).toUpperCase() : 'INDUSTRY';
  const graphics = buildGraphics({
    imageUrl: c.ogImage || '',
    graphicHeadline: g.graphicHeadline,
    highlightWords: g.highlightWords,
    summary: g.summary,
    category,
    siteName: c.siteName,
    source: c.source
  });
  const liWords = words(g.liCaption);
  const liShort = liWords < 200;
  const liExpandPrompt = liShort
    ? `Expand this LinkedIn post using ONLY facts from the article text below. Return ONLY JSON: {"liHook":"bold opening, no emoji, max 25 words","liParagraphs":[5 paragraphs of 2-4 sentences, 45-80 words each],"liTakeaway":"one crisp sentence"}. No URLs, hashtags or line breaks inside fields.\n\nCURRENT POST:\n${g.liCaption}\n\nARTICLE TEXT:\n${c.text}`
    : '';
  return {
    accuracyRetry: false,
    accuracyNote: fixNote,
    story: c,
    gen: g,
    category,
    failures,
    liShort,
    liWords,
    liExpandPrompt,
    html: graphics.html,
    storyHtml: graphics.storyHtml
  };
}

function layoutErrors(gen, story) {
  return [...checkIg(gen.igCaption, story.link), ...checkAccuracy(gen, story).map(x => 'accuracy: ' + x)];
}

function mergeLiCaption(gen, storyLink, modelText, fallbackCaption) {
  let liCaption = fallbackCaption;
  let liWarning = null;
  try {
    const p = JSON.parse((String(modelText || '').match(/\{[\s\S]*\}/) || ['{}'])[0]);
    const cand = buildLi(Object.assign({}, gen, p), storyLink);
    const w = cand.split(/\s+/).length;
    if (p.liParagraphs && checkLi(cand).length === 0 && w >= 200) liCaption = cand;
    else liWarning = 'LinkedIn caption short after retry - posted anyway';
  } catch (e) {
    liWarning = 'LinkedIn retry unparseable - posted original';
  }
  return { liCaption, liWarning };
}

function slugFromTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(x => x.length >= 2).slice(0, 6).join('-');
}

function toHtml(cap) {
  return String(cap || '').split(/\n\n+/).map(p => p.trim()).filter(p => p && !/^Source:/i.test(p) && !/^https?:/.test(p) && !/^Get the daily/i.test(p) && !/^#\w/.test(p)).map(p => '<p>' + p.replace(/\n/g, ' ') + '</p>').join('\n');
}

function assemblePublish({ story, gen, category, liCaption, liWarning, today, slot, siteUrl, now = new Date() }) {
  let caption = liCaption;
  let warning = liWarning;
  if (caption.length > 2950) {
    caption = caption.slice(0, 2950).replace(/\s+\S*$/, '') + '…';
    warning = (warning ? warning + '; ' : '') + 'LinkedIn caption trimmed to 3000 chars';
  }
  const slug = slugFromTitle(story.title);
  const stamp = String(today).replace(/-/g, '');
  const pngName = `aifeed_${slug}_${stamp}_${Number(slot) === 1 ? 'am' : 'pm'}.png`;
  const storyName = pngName.replace(/\.png$/, '_story.png');
  const nowIso = now.toISOString();
  const post = {
    id: slug + '-' + stamp,
    slug,
    headline: story.title,
    summary: gen.summary,
    body: toHtml(caption),
    category: category.charAt(0) + category.slice(1).toLowerCase(),
    imageUrl: `${siteUrl}/images/${pngName}`,
    image: `images/${pngName}`,
    sourceUrl: story.link,
    publishedAt: nowIso,
    hashtags: (gen.igCaption.match(/#(\w+)/g) || []).map(t => t.slice(1)),
    isVideo: false
  };
  const historyEntry = {
    postedAt: nowIso,
    date: today,
    slot: Number(slot),
    headline: story.title,
    canonUrl: story.canonUrl,
    url: story.link,
    slug,
    image: pngName
  };
  return { slug, pngName, storyName, storyUrl: `${siteUrl}/images/${storyName}`, post, historyEntry, liCaption: caption, liWarning: warning, igCaption: gen.igCaption };
}

function mergeHistory(fresh, { entry, rankings }) {
  const h = fresh && typeof fresh === 'object' ? fresh : { posted: [], rankings: {} };
  h.posted = Array.isArray(h.posted) ? h.posted : [];
  h.rankings = Object.assign({}, h.rankings || {}, rankings || {});
  Object.keys(h.rankings).sort().slice(0, -14).forEach(k => delete h.rankings[k]);
  const exists = h.posted.some(p => p && p.date === entry.date && Number(p.slot) === Number(entry.slot));
  if (!exists) h.posted.unshift(entry);
  h.posted = h.posted.slice(0, 2000);
  return h;
}

module.exports = {
  CATS, words, runQuality, layoutErrors, mergeLiCaption, slugFromTitle, toHtml, assemblePublish, mergeHistory, applyAccuracyFix
};
