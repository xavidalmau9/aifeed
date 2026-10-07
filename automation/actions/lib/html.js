// Graphic HTML for the 1080x1350 feed card and the 1080x1920 Story.
// Markup, CSS, and the in-page text-fit script are the live n8n "Quality Checks + Build HTML" output.
const { normText } = require('./captions');

function buildGraphics({ imageUrl, graphicHeadline, highlightWords, summary, category, siteName, source }) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const g = {
    graphicHeadline: normText(graphicHeadline).toUpperCase(),
    highlightWords,
    summary: normText(summary)
  };
  const c = { ogImage: imageUrl || '', siteName: siteName || '', source: source || '' };
  const cat = category;
const hwords = String(g.graphicHeadline).toUpperCase().split(/\s+/);
const k = Math.min(Math.max(parseInt(g.highlightWords) || 2, 1), Math.min(3, hwords.length - 1));
// last two words are glued with &nbsp; so no line can end with a single orphan word
// hyphenated words (5-MINUTE, GPT-5) never split at the hyphen
const hw2 = hwords.map(w => /-/.test(w) ? '<span class="nw">' + esc(w) + '</span>' : esc(w)), cut = hw2.length - k;
const join = arr => arr.map((w, i) => (i === 0 ? '' : (i === arr.length - 1 ? '&nbsp;' : ' ')) + w).join('');
const hlHtml = (k >= 2 || cut < 1)
  ? hw2.slice(0, cut).join(' ') + (cut ? ' ' : '') + '<span class="pink">' + join(hw2.slice(cut)) + '</span>'
  : hw2.slice(0, cut).join(' ') + '&nbsp;<span class="pink">' + hw2[cut] + '</span>';
const sumHtml = (() => { const w = normText(g.summary).split(' ').map(esc); return w.length > 2 ? w.slice(0, -1).join(' ') + '&nbsp;' + w[w.length - 1] : w.join(' '); })();
const fontPx = String(g.graphicHeadline).length > 40 ? 84 : String(g.graphicHeadline).length > 28 ? 96 : 108;
const photo = c.ogImage || 'https://source.unsplash.com/1080x1350/?technology,ai';
const domain = c.source;
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;800;900&family=Inter:wght@400;500&display=block" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1350px;overflow:hidden;background:#0d0b14}
.wrap{position:relative;width:1080px;height:1350px;font-family:Inter,sans-serif;color:#fff}
.photo{position:absolute;inset:0;background:url("${esc(photo)}") center/cover no-repeat}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,11,20,0) 0%,rgba(13,11,20,.05) 38%,rgba(13,11,20,.82) 58%,#0d0b14 72%,#0d0b14 100%)}
.badge{position:absolute;top:44px;left:44px;padding:14px 26px;border-radius:40px;font:800 26px Poppins;letter-spacing:.5px;background:linear-gradient(90deg,#ff8a00,#c040ff)}
.content{position:absolute;left:56px;right:56px;bottom:120px}
.cat{display:inline-block;padding:10px 22px;border-radius:30px;border:2px solid #ff5f8f;background:rgba(255,95,143,.25);color:#ff8fb0;font:600 24px Poppins;letter-spacing:3px;margin-bottom:28px}
h1{font:900 ${fontPx}px/1.04 Poppins;text-wrap:balance;overflow-wrap:normal;text-transform:uppercase;letter-spacing:-1px}
.pink{color:#ff6f91}
.nw{white-space:nowrap}
.rule{width:52px;height:4px;background:linear-gradient(90deg,#ff8a00,#c040ff);margin:34px 0 26px}
p{font:400 32px/1.42 Inter;color:#d9d6e3;text-wrap:pretty}
.foot{position:absolute;left:0;right:0;bottom:0;height:92px;background:#0a0910;display:flex;align-items:center;justify-content:space-between;padding:0 56px}
.src{font:400 24px Inter;color:#77738a}
.logo{font:800 36px Poppins;background:linear-gradient(90deg,#ff8a00,#c040ff);-webkit-background-clip:text;color:transparent}
.logo b{color:#fff;-webkit-text-fill-color:#fff}
</style></head><body><div class="wrap">
<div class="photo"></div><div class="shade"></div>
<div class="badge">AIFEED.RUN • AI NEWS</div>
<div class="content"><div class="cat">${cat}</div><h1>${hlHtml}</h1><div class="rule"></div><p>${sumHtml}</p></div>
<div class="foot"><div class="src">Source: ${esc(c.siteName)} · ${esc(domain)}</div><div class="logo">aifeed<b>.run</b></div></div>
</div><script>
(function(){
  // Text-fit: shrink headline/summary until the block fits its box, no clipping, no orphan last word.
  const R = {ok:true, notes:[]};
  const H = document.querySelector('h1'), P = document.querySelector('.content p'), C = document.querySelector('.content'), T = document.querySelector('.badge');
  const minTop = T.getBoundingClientRect().bottom + 40;
  const lines = el => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  const overflowX = el => el.scrollWidth > el.clientWidth + 1;
  const orphan = el => { const r = document.createRange(); r.selectNodeContents(el); const rects = [...r.getClientRects()].filter(x => x.width > 0); if (rects.length < 2) return false; const lastTop = rects[rects.length-1].top; const lastLine = rects.filter(x => Math.abs(x.top - lastTop) < 4); const words = (el.innerText || '').split('\\n').pop().trim().split(/\\s+/); return lastLine.reduce((a,x)=>a+x.width,0) < el.clientWidth * 0.12 && words.length < 2; };
  let hf = parseFloat(getComputedStyle(H).fontSize), pf = parseFloat(getComputedStyle(P).fontSize), ug = false;
  for (let i = 0; i < 40; i++) {
    const bad = C.getBoundingClientRect().top < minTop || lines(H) > 4 || overflowX(H) || lines(P) > 3;
    if (!bad) break;
    if (lines(H) > 4 || overflowX(H) || hf > 64 + 20) { if (hf > 64) { hf -= 4; H.style.fontSize = hf + 'px'; continue; } }
    // last resort for a too-wide glued word pair (e.g. 'WORKSPACE INTEGRATION'): let it break normally
    if ((overflowX(H) || overflowX(P)) && !ug) { ug = true; [H, P].forEach(el => { el.innerHTML = el.innerHTML.replace(/&nbsp;|\u00a0/g, ' '); }); continue; }
    if (pf > 26) { pf -= 2; P.style.fontSize = pf + 'px'; continue; }
    break;
  }
  [H, P].forEach(el => { if (orphan(el)) { el.style.textWrap = 'balance'; } });
  if (C.getBoundingClientRect().top < minTop) { R.ok = false; R.notes.push('content overlaps top badge'); }
  if (lines(H) > 4) { R.ok = false; R.notes.push('headline > 4 lines'); }
  if (overflowX(H) || overflowX(P)) { R.ok = false; R.notes.push('horizontal overflow'); }
  if (lines(P) > 3) { R.ok = false; R.notes.push('summary > 3 lines'); }
  if (orphan(H)) { R.ok = false; R.notes.push('headline orphan word'); }
  if (C.getBoundingClientRect().bottom > document.querySelector('.foot').getBoundingClientRect().top - 20) { R.ok = false; R.notes.push('content overlaps footer'); }
  R.headlinePx = hf; R.summaryPx = pf; R.headlineLines = lines(H); R.summaryLines = lines(P);
  window.__fitReport = R;
})();
</script></body></html>`;

// ── 9:16 Story version (safe zones: top 250px / bottom 340px kept clear of key content) ──
const sFont = String(g.graphicHeadline).length > 40 ? 92 : String(g.graphicHeadline).length > 28 ? 104 : 116;
const storyHtml = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;800;900&family=Inter:wght@400;500&display=block" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1920px;overflow:hidden;background:#0d0b14}
.wrap{position:relative;width:1080px;height:1920px;font-family:Inter,sans-serif;color:#fff}
.photo{position:absolute;left:0;right:0;top:0;height:1250px;background:url("${esc(photo)}") center/cover no-repeat}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,11,20,.55) 0%,rgba(13,11,20,0) 16%,rgba(13,11,20,0) 38%,rgba(13,11,20,.85) 50%,#0d0b14 64%,#0d0b14 100%)}
.top{position:absolute;top:260px;left:64px;right:64px;display:flex;justify-content:space-between;align-items:center}
.badge{padding:16px 30px;border-radius:44px;font:800 30px Poppins;background:linear-gradient(90deg,#ff8a00,#c040ff)}
.new{padding:14px 26px;border-radius:44px;font:800 30px Poppins;background:#fff;color:#0d0b14}
.content{position:absolute;left:64px;right:64px;bottom:540px}
.cat{display:inline-block;padding:12px 24px;border-radius:30px;border:2px solid #ff5f8f;background:linear-gradient(rgba(255,95,143,.25),rgba(255,95,143,.25)),rgba(13,11,20,.6);color:#ff8fb0;font:600 28px Poppins;letter-spacing:3px;margin-bottom:30px}
h1{font:900 ${sFont}px/1.04 Poppins;text-wrap:balance;overflow-wrap:normal;text-transform:uppercase;letter-spacing:-1px;text-shadow:0 2px 22px rgba(13,11,20,.55)}
.pink{color:#ff6f91}
.nw{white-space:nowrap}
.rule{width:60px;height:5px;background:linear-gradient(90deg,#ff8a00,#c040ff);margin:36px 0 28px}
p{font:400 36px/1.42 Inter;color:#d9d6e3;text-wrap:pretty}
.foot{position:absolute;left:0;right:0;bottom:350px;text-align:center}
.cta{font:600 32px Poppins;color:#bdb8cc;margin-bottom:14px}
.logo{font:800 56px Poppins;background:linear-gradient(90deg,#ff8a00,#c040ff);-webkit-background-clip:text;color:transparent}
.logo b{-webkit-text-fill-color:#fff}
</style></head><body><div class="wrap">
<div class="photo"></div><div class="shade"></div>
<div class="top"><div class="badge">AIFEED.RUN • AI NEWS</div><div class="new">NEW POST ↓</div></div>
<div class="content"><div class="cat">${cat}</div><h1>${hlHtml}</h1><div class="rule"></div><p>${sumHtml}</p></div>
<div class="foot"><div class="cta">Tap to read the full post · Source: ${esc(c.siteName)}</div><div class="logo">aifeed<b>.run</b></div></div>
</div><script>
(function(){
  // Text-fit: shrink headline/summary until the block fits its box, no clipping, no orphan last word.
  const R = {ok:true, notes:[]};
  const H = document.querySelector('h1'), P = document.querySelector('.content p'), C = document.querySelector('.content'), T = document.querySelector('.top');
  const minTop = T.getBoundingClientRect().bottom + 40;
  const lines = el => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  const overflowX = el => el.scrollWidth > el.clientWidth + 1;
  const orphan = el => { const r = document.createRange(); r.selectNodeContents(el); const rects = [...r.getClientRects()].filter(x => x.width > 0); if (rects.length < 2) return false; const lastTop = rects[rects.length-1].top; const lastLine = rects.filter(x => Math.abs(x.top - lastTop) < 4); const words = (el.innerText || '').split('\\n').pop().trim().split(/\\s+/); return lastLine.reduce((a,x)=>a+x.width,0) < el.clientWidth * 0.12 && words.length < 2; };
  let hf = parseFloat(getComputedStyle(H).fontSize), pf = parseFloat(getComputedStyle(P).fontSize), ug = false;
  for (let i = 0; i < 40; i++) {
    const bad = C.getBoundingClientRect().top < minTop || lines(H) > 5 || overflowX(H) || lines(P) > 4;
    if (!bad) break;
    if (lines(H) > 5 || overflowX(H) || hf > 72 + 20) { if (hf > 72) { hf -= 4; H.style.fontSize = hf + 'px'; continue; } }
    // last resort for a too-wide glued word pair (e.g. 'WORKSPACE INTEGRATION'): let it break normally
    if ((overflowX(H) || overflowX(P)) && !ug) { ug = true; [H, P].forEach(el => { el.innerHTML = el.innerHTML.replace(/&nbsp;|\u00a0/g, ' '); }); continue; }
    if (pf > 30) { pf -= 2; P.style.fontSize = pf + 'px'; continue; }
    break;
  }
  [H, P].forEach(el => { if (orphan(el)) { el.style.textWrap = 'balance'; } });
  if (C.getBoundingClientRect().top < minTop) { R.ok = false; R.notes.push('content overlaps top badge'); }
  if (lines(H) > 5) { R.ok = false; R.notes.push('headline > 5 lines'); }
  if (overflowX(H) || overflowX(P)) { R.ok = false; R.notes.push('horizontal overflow'); }
  if (lines(P) > 4) { R.ok = false; R.notes.push('summary > 4 lines'); }
  if (orphan(H)) { R.ok = false; R.notes.push('headline orphan word'); }
  // Legibility: the static shade only gets dark around 960px, but a 3-5 line headline starts near 700px,
  // so on a bright photo the top lines sat on bare image. Anchor the gradient to the actual text block.
  const S = document.querySelector('.shade'), ct = Math.round(C.getBoundingClientRect().top);
  const a = Math.max(320, ct - 220), b = ct + 70, d = ct + 360;
  S.style.background = 'linear-gradient(180deg,rgba(13,11,20,.55) 0px,rgba(13,11,20,0) 307px,rgba(13,11,20,0) ' + a + 'px,rgba(13,11,20,.78) ' + b + 'px,#0d0b14 ' + d + 'px,#0d0b14 100%)';
  R.shadeTop = a;
  if (C.getBoundingClientRect().bottom > document.querySelector('.foot').getBoundingClientRect().top - 20) { R.ok = false; R.notes.push('content overlaps footer'); }
  R.headlinePx = hf; R.summaryPx = pf; R.headlineLines = lines(H); R.summaryLines = lines(P);
  window.__fitReport = R;
})();
</script></body></html>`;
  return { html, storyHtml };
}

module.exports = { buildGraphics };
