// Article fetch + caption prompt. Same fields and accuracy rules as the live n8n node.

function meta(html, p) {
  const m = String(html || '').match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)`, 'i'))
    || String(html || '').match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, 'i'));
  return m ? m[1] : '';
}

function buildCaptionPrompt(usable) {
  const blocks = usable.map((c, i) => `### CANDIDATE ${i}\nHeadline: ${c.title}\nPublication: ${c.siteName}\nURL: ${c.link}\nFeed description: ${c.desc || c.description || '(none)'}\nArticle text (truncated): ${c.text}`).join('\n\n');
  return `For EACH candidate below write AIFeed.run social copy using ONLY facts stated in its article text. Return STRUCTURED parts only; our code assembles and formats the final captions, so do NOT include emojis except where stated, URLs, "Source" lines, hashtags inside text, or line breaks inside fields.

ACCURACY RULES (strict; copy that breaks them is rejected automatically):
- Keep every hedge from the source: considers, plans, reportedly, in talks, sources say, may, expected to, up to, proposed. If the source reports something as a plan, talks, a rumor or "sources say", the graphicHeadline, summary and igHook must ALL say so too (e.g. "DEEPSEEK WEIGHS DOUBLING ROUND TO UP TO $15B", not "DEEPSEEK DOUBLES FUNDING TO $15B").
- Never state a rumor, plan, proposal or report as done. Do not upgrade "up to" to an exact figure.
- Never invent details that are not in the article text (no "strong demand", motives, outcomes, quotes or numbers that are not there).
- Keep currency symbols and units exactly: "$15B" or "$15 billion", never "15 BILLION". Keep non-dollar currencies as written (e.g. "100 billion yuan").

Fields per candidate:
- igHook: one punchy line, starts with exactly one strong emoji (🚀💡🔥🤖⚡️📉📈⚠️🧠), max 18 words.
- igParagraphs: array of 3 or 4 short paragraphs, each 1-2 sentences, 15-45 words, conversational, no emojis.
- liHook: bold opening statement or surprising stat, no emoji, max 25 words.
- liParagraphs: array of 5 paragraphs (what happened; business/tech context; strategic implications; industry impact; outlook), each 2-4 sentences, 40-80 words.
- liTakeaway: one crisp takeaway sentence.
- igHashtags: exactly 5 hashtags without the # sign, letters/digits only (e.g. "OpenAI").
- liHashtags: exactly 5 professional hashtags, same format.
- outlet: publication name as it brands itself (e.g. "CNBC", "The Verge", "9to5Google").
- graphicHeadline: ALL CAPS, 4-8 words, punchy, factual, hedged when the source is hedged, $ kept on money. highlightWords: number of trailing words of graphicHeadline to color pink (1-3).
- summary: 1 sentence, 14-26 words.
- category: one of BUSINESS, MODELS, TOOLS, RESEARCH, POLICY, HARDWARE, SAFETY.
- supported: false if any claim is not in the article text, or the article is opinion, an ad, a rumor, or not about AI.
- safe: false for anything defamatory, graphic, or medical/financial advice.
- issues: short note.

${blocks}

Return ONLY a JSON array, one object per candidate in the same order:
[{"candidate":0,"igHook":"...","igParagraphs":["..."],"liHook":"...","liParagraphs":["..."],"liTakeaway":"...","igHashtags":["..."],"liHashtags":["..."],"outlet":"...","graphicHeadline":"...","highlightWords":2,"summary":"...","category":"...","supported":true,"safe":true,"issues":""}]`;
}

async function fetchArticles(candidates, { fetchImpl = globalThis.fetch } = {}) {
  const out = await Promise.all(candidates.map(async c => {
    let ok = false;
    let html = '';
    try {
      const res = await fetchImpl(c.link, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
        signal: AbortSignal.timeout(25000),
        redirect: 'follow'
      });
      html = await res.text();
      ok = html.length > 2000;
    } catch (e) {
      ok = false;
    }
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3500);
    return Object.assign({}, c, {
      linkOk: ok,
      ogImage: meta(html, 'og:image') || meta(html, 'twitter:image'),
      siteName: meta(html, 'og:site_name') || c.source,
      description: meta(html, 'og:description'),
      text
    });
  }));
  const usable = out.filter(c => c.linkOk);
  if (!usable.length) throw new Error('All candidate source links failed to load');
  return { usable, captionPrompt: buildCaptionPrompt(usable) };
}

module.exports = { meta, buildCaptionPrompt, fetchArticles };
