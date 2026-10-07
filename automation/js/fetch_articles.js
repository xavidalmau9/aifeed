// Verifies each candidate link loads; grabs og:image, site name, description and body text for fact-checking.
const { candidates, history } = $input.first().json;
const meta = (html, p) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, 'i')); return m ? m[1] : ''; };
const out = await Promise.all(candidates.map(async c => {
  let ok = false, html = '';
  try { html = String(await this.helpers.httpRequest({ method: 'GET', url: c.link, timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36' } })); ok = html.length > 2000; } catch (e) { ok = false; }
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3500);
  return { ...c, linkOk: ok, ogImage: meta(html, 'og:image') || meta(html, 'twitter:image'), siteName: meta(html, 'og:site_name') || c.source, description: meta(html, 'og:description'), text };
}));
const usable = out.filter(c => c.linkOk);
if (!usable.length) throw new Error('All candidate source links failed to load');
const blocks = usable.map((c, i) => `### CANDIDATE ${i}\nHeadline: ${c.title}\nPublication: ${c.siteName}\nURL: ${c.link}\nArticle text (truncated): ${c.text}`).join('\n\n');
const captionPrompt = `For EACH candidate below write AIFeed.run social copy using ONLY facts stated in its article text. Return STRUCTURED parts only; our code assembles and formats the final captions, so do NOT include emojis except where stated, URLs, "Source" lines, hashtags inside text, or line breaks inside fields.

Fields per candidate:
- igHook: one punchy line, starts with exactly one strong emoji (🚀💡🔥🤖⚡️📉📈⚠️🧠), max 18 words.
- igParagraphs: array of 3 or 4 short paragraphs, each 1-2 sentences, 15-45 words, conversational, no emojis.
- liHook: bold opening statement or surprising stat, no emoji, max 25 words.
- liParagraphs: array of 5 paragraphs (what happened; business/tech context; strategic implications; industry impact; outlook), each 2-4 sentences, 40-80 words.
- liTakeaway: one crisp takeaway sentence.
- igHashtags: exactly 5 hashtags without the # sign, letters/digits only (e.g. "OpenAI").
- liHashtags: exactly 5 professional hashtags, same format.
- outlet: publication name as it brands itself (e.g. "CNBC", "The Verge", "9to5Google").
- graphicHeadline: ALL CAPS, 4-8 words, punchy, factual. highlightWords: number of trailing words of graphicHeadline to color pink (1-3).
- summary: 1 sentence, 14-26 words.
- category: one of BUSINESS, MODELS, TOOLS, RESEARCH, POLICY, HARDWARE, SAFETY.
- supported: false if any claim is not in the article text, or the article is opinion, an ad, a rumor, or not about AI.
- safe: false for anything defamatory, graphic, or medical/financial advice.
- issues: short note.

${blocks}

Return ONLY a JSON array, one object per candidate in the same order:
[{"candidate":0,"igHook":"...","igParagraphs":["..."],"liHook":"...","liParagraphs":["..."],"liTakeaway":"...","igHashtags":["..."],"liHashtags":["..."],"outlet":"...","graphicHeadline":"...","highlightWords":2,"summary":"...","category":"...","supported":true,"safe":true,"issues":""}]`;
return [{ json: { usable, history, captionPrompt } }];
