import sys, asyncio
from playwright.async_api import async_playwright
jobs=[(u,o,w,h) for u,o,w,h in [x.split('|') for x in sys.argv[1:]]]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for u,o,w,h in jobs:
            mobile=int(w)<600
            c=await b.new_context(viewport={'width':int(w),'height':int(h)},device_scale_factor=2 if mobile else 1,is_mobile=mobile,has_touch=mobile)
            pg=await c.new_page()
            await pg.goto(u,wait_until='load',timeout=45000)
            await pg.wait_for_timeout(1500)
            # scroll to trigger lazy images
            H=await pg.evaluate('document.body.scrollHeight')
            for y in range(0,H,600):
                await pg.evaluate(f'window.scrollTo(0,{y})'); await pg.wait_for_timeout(80)
            await pg.evaluate('window.scrollTo(0,0)'); await pg.wait_for_timeout(800)
            await pg.screenshot(path=o,full_page=True)
            await pg.screenshot(path=o.replace('.png','-fold.png'))
            print(o, H)
            await c.close()
        await b.close()
asyncio.run(main())
