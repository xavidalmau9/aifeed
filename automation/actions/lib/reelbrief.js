// Reel brief: one short LLM call (the pipeline's existing Anthropic model) that writes the Reel's punch headline and a
// story-themed scene prompt. make_reel.py validates both and falls back to its rule-based punch + theme map, so a
// failed/invalid brief never blocks a Reel.
const BANNED = /\b(daily|hand[- ]?edited|human[- ]?edited|edited by|our editors?)\b/i;

function buildReelBriefPrompt(post) {
  const body = String(post.summary || '').slice(0, 600);
  return `You design the cover of a vertical news Reel for @aifeed.run (US tech/AI news, poster style).
Story headline: ${post.headline}
Category: ${post.category || ''}
Summary: ${body}

Return ONLY JSON: {"punch": "...", "scene": "...", "keywords": ["...", "..."]}
- punch: a short, punchy ALL-CAPS headline for the cover, 3 or 4 lines separated by " / ", each line at most 16 characters.
  Prefix exactly ONE line with "*" (the accent line, usually the key fact or verb phrase). Use only facts from the headline
  and summary; keep company names; no clickbait, no question unless the headline is one; never use the word "daily".
  Example: "COREWEAVE / CREDIT STRESS / *HITS DISTRESS / LEVELS"
- scene: one sentence describing a dramatic, photorealistic scene that matches the story's THEME (not just its category),
  as a visual metaphor a top US news outlet would use. Examples: credit/debt stress -> "a stressed trader in shadow, head in hand,
  before monitors of red crashing charts"; genomics limits -> "a tangled, glitching DNA helix hologram in a dark lab, a scientist
  silhouette from behind". No text, no logos, no real identifiable people (silhouettes or faces hidden only), no brand names.
- keywords: 2 short photo-search phrases for a real photo of the same theme (e.g. "stock market crash screen").`;
}

function validPunch(p) {
  if (typeof p !== 'string') return false;
  const lines = p.split('/').map(s => s.trim()).filter(Boolean);
  return lines.length >= 2 && lines.length <= 4 && lines.filter(l => l.startsWith('*')).length === 1
    && lines.every(l => l.replace(/^\*/, '').length <= 22) && !BANNED.test(p);
}

function parseReelBrief(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return {};
  let j;
  try { j = JSON.parse(m[0]); } catch (e) { return {}; }
  const out = {};
  if (validPunch(j.punch)) out.punch = j.punch.split('/').map(s => s.trim()).filter(Boolean).map(s => s.toUpperCase()).join(' / ');
  if (typeof j.scene === 'string' && j.scene.trim().length >= 20 && !BANNED.test(j.scene)) out.scenePrompt = j.scene.trim().slice(0, 400);
  if (Array.isArray(j.keywords)) out.sceneKeywords = j.keywords.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().slice(0, 60)).slice(0, 3);
  return out;
}

async function reelBrief(post, ask) {
  try {
    return parseReelBrief(await ask(buildReelBriefPrompt(post)));
  } catch (e) {
    return {};
  }
}

module.exports = { buildReelBriefPrompt, parseReelBrief, validPunch, reelBrief };
