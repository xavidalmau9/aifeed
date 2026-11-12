import json,asyncio
from playwright.async_api import async_playwright
from PIL import Image,ImageDraw,ImageFont
R=json.load(open('palettes.json')); CSS=open('site.css').read()
def ov(p): return ':root{'+''.join(f'--cat-{c.lower()}:{v};' for c,v in p.items())+f'--cat-security:{p["Safety"]};'+'}'
def panel(k,o):
    p=o['pal']; cats=list(p)+['Security']
    pills=''.join(f'<span class="pill" style="--c:var(--cat-{c.lower()})">{c}</span>' for c in cats)
    rows=''.join(f'<tr><td><span class="sw" style="background:{h}"></span>{c}</td><td>{h}</td><td>{a}:1 on bg</td><td>{b}:1 on fill</td></tr>' for c,h,a,b,_ in o['rows'])
    chips=''.join(f'<span class="chip" style="--c:var(--cat-{c.lower()})"><span class="dot"></span>{c}</span>' for c in cats)
    return f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../prototype/tokens.css"><style>{CSS}{ov(p)}
body{{padding:24px 20px 28px}} h2{{margin:0 0 4px;font:800 1.25rem/1.2 var(--font-display)}} .sub{{margin:0 0 16px;color:var(--muted);font-size:.875rem}}
.grid{{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}} .lab{{font:700 .6875rem/1 var(--font-body);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}}
body::before{{display:none}} table{{width:100%;border-collapse:collapse;font-size:.8125rem;color:var(--text-2)}} td{{padding:6px 4px;border-top:1px solid var(--border)}} td:first-child{{display:flex;align-items:center;gap:8px;color:var(--text);font-weight:600}} .sw{{width:14px;height:14px;border-radius:4px;flex:none}}</style></head><body>
<h2>Option {k.upper()}: {o['name']}</h2><p class="sub">Every category, as card pills and as topic chips</p>
<p class="lab">Card pills</p><div class="grid">{pills}</div><p class="lab">Topic chips</p><div class="grid">{chips}</div><p class="lab">Contrast (WCAG AA needs 4.5:1)</p><table>{rows}</table></body></html>'''
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch()
        for k,o in R.items():
            open(f'/tmp/panel-{k}.html','w').write(panel(k,o).replace('../prototype/','/workspace/aifeed-redesign/prototype/'))
            c=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True)
            pg=await c.new_page(); await pg.goto('file:///workspace/aifeed-redesign/prototype/index.html'); await pg.add_style_tag(content=ov(o['pal']))
            await pg.wait_for_timeout(600); await pg.screenshot(path=f'/tmp/fold-{k}.png')
            pg2=await c.new_page(); await pg2.goto(f'file:///tmp/panel-{k}.html'); await pg2.wait_for_timeout(400)
            await pg2.screenshot(path=f'/tmp/panel-{k}.png',full_page=True); await c.close()
            f=Image.open(f'/tmp/fold-{k}.png'); p=Image.open(f'/tmp/panel-{k}.png')
            out=Image.new('RGB',(f.width,f.height+p.height+4),(40,36,80)); out.paste(f,(0,0)); out.paste(p,(0,f.height+4))
            out.save(f'../palettes/option-{k}.png'); print(k,out.size)
        await b.close()
    ims=[Image.open(f'../palettes/option-{k}.png') for k in 'abc']; g=48
    H=max(i.height for i in ims); W=sum(i.width for i in ims)+g*4
    out=Image.new('RGB',(W,H+g*2),(4,2,14)); x=g
    for i in ims: out.paste(i,(x,g)); x+=i.width+g
    out.save('../palettes/compare.png'); print('compare',out.size)
asyncio.run(main())
