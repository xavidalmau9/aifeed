// Topic mix (Javier approved Nov 16 2026 after the weekly growth analysis): chip, China, spy and security stories
// win on Instagram; stat-only "study finds" / survey / percentage stories flop. A small, explainable nudge on top of
// the model's 0-100 rank score (lib/pick.js orderPool); the rank prompt (lib/rss.js) says the same thing in words.
const BOOST = [
  ['chips', /\b(nvidia|chips?|chipmakers?|semiconductors?|gpus?|tsmc|asml|export controls?)\b/i],
  ['china', /\b(china|chinese|beijing|huawei|deepseek|taiwan)\b/i],
  ['spy', /\b(spy|spies|spying|spyware|espionage|surveillance|national security|pentagon|military|intelligence agenc\w*|cia|nsa|fbi)\b/i],
  ['security', /\b(hack(s|ed|ers?|ing)?|breach(es|ed)?|ransomware|cyber ?attacks?|malware|zero[- ]?days?|vulnerabilit\w*|exploit(s|ed)?|leak(s|ed)?|stolen|phishing)\b/i],
  ['protest', /\b(protests?|protesters?|protested|boycotts?|backlash|walkouts?)\b/i],
  ['gone-wrong', /\b(rogue|went wrong|goes wrong|gone wrong|backfir\w*|lawsuits?|sued|deepfakes?|scams?|scammers?|blackmail\w*|deceiv\w*|lied|lying|hallucinat\w*|wiped|recall(s|ed)?|bann?(ed|s)?|fake)\b/i]
];
// Stat-only: the headline IS a number from a study/survey/poll, with no concrete event behind it.
const STAT = /\b(study|studies|survey(s|ed)?|poll(s|ed)?|report finds|researchers? (find|found|say)|finds that|per ?cent|percentage|majority of|in (\d+|ten|five|four|three) (americans|people|workers|adults|users|companies|ceos|teens))\b|\d+(\.\d+)?\s?%/i;

const BOOST_FIRST = 15, BOOST_MORE = 5, BOOST_MAX = 25, STAT_PENALTY = 20;

// -> { adj, tags } for one candidate ({ title, desc }). Boosts read title + description; the stat demotion reads the
// headline only and never applies to a story that also hits a boosted topic (a China hack with a number is still good).
function topicAdjust(item = {}) {
  const title = String(item.title || ''), text = title + ' ' + String(item.desc || item.summary || '');
  const tags = BOOST.filter(([, re]) => re.test(text)).map(([t]) => t);
  let adj = tags.length ? Math.min(BOOST_MAX, BOOST_FIRST + BOOST_MORE * (tags.length - 1)) : 0;
  if (!tags.length && STAT.test(title)) { adj -= STAT_PENALTY; tags.push('stat-only'); }
  return { adj, tags };
}

// Re-order the model's ranking by score + topic nudge (stable). ranked = [{ index, score }], fresh = candidates.
function applyTopicMix(ranked, fresh) {
  return ranked
    .map((r, i) => {
      const item = fresh[parseInt(r.index, 10) - 1];
      const base = Number.isFinite(Number(r.score)) ? Number(r.score) : 100 - i * 5;
      return { r, i, s: base + (item ? topicAdjust(item).adj : 0) };
    })
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => x.r);
}

module.exports = { BOOST, STAT, topicAdjust, applyTopicMix };
