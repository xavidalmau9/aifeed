import asyncio
from playwright.async_api import async_playwright
async def m():
  async with async_playwright() as p:
    b=await p.chromium.launch(); c=await b.new_context(viewport={'width':390,'height':844},is_mobile=True,device_scale_factor=2)
    pg=await c.new_page(); await pg.goto('https://aifeed.run/',wait_until='load'); await pg.wait_for_timeout(2500)
    print(await pg.evaluate('''()=>{const r=[];document.querySelectorAll('body *').forEach(e=>{const b=e.getBoundingClientRect();if(b.right>392&&b.width>0)r.push(e.tagName+'.'+e.className+' '+Math.round(b.right))});return [document.documentElement.scrollWidth, r.slice(0,8)]}'''))
    print(await pg.evaluate('''()=>[...document.querySelectorAll('a,button')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.height<40}).slice(0,10).map(e=>e.textContent.trim().slice(0,20)+':'+Math.round(e.getBoundingClientRect().height))'''))
    await b.close()
asyncio.run(m())
