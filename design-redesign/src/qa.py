import asyncio
from playwright.async_api import async_playwright
JS='''()=>{const out=[];const boxes=[...document.querySelectorAll('.lead,.row,.card,.nl-card,.follow-card,.kt,.source-card,.next,.topic,.chip,.btn,.pill,.follow-btn,.tag')];
for(const b of boxes){const R=b.getBoundingClientRect();const pad=parseFloat(getComputedStyle(b).paddingRight)||0;
 const w=document.createTreeWalker(b,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(!n.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(n);for(const q of r.getClientRects()){
  const gapR=R.right-q.right, gapL=q.left-R.left; if(gapR<Math.min(12,pad-1)||gapL<Math.min(12,(parseFloat(getComputedStyle(b).paddingLeft)||0)-1)) out.push(b.className+' | '+n.textContent.trim().slice(0,30)+' gapL='+gapL.toFixed(0)+' gapR='+gapR.toFixed(0));}}}
const sw=document.documentElement.scrollWidth;
const small=[...document.querySelectorAll('a,button,input')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<36&&!e.closest('.row-title,.card-title,.lead-title,.prose,.by-src,.next-t')}).map(e=>e.className+':'+e.textContent.trim().slice(0,15)+':'+Math.round(e.getBoundingClientRect().height));
return {sw,issues:[...new Set(out)].slice(0,20),small:[...new Set(small)].slice(0,15)}}'''
async def m():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for f in ['index.html','article.html','404.html']:
      for w,h in [(390,844),(1440,900)]:
        c=await b.new_context(viewport={'width':w,'height':h}); pg=await c.new_page()
        await pg.goto('file:///workspace/aifeed-redesign/prototype/'+f); await pg.wait_for_timeout(700)
        print(f,w,await pg.evaluate(JS)); await c.close()
    await b.close()
asyncio.run(m())
