import asyncio
from playwright.async_api import async_playwright
async def m():
  async with async_playwright() as p:
    b=await p.chromium.launch(); c=await b.new_context(viewport={'width':390,'height':844},is_mobile=True)
    pg=await c.new_page(); await pg.goto('https://aifeed.run/news/how-ai-security-failures-are-endangering/',wait_until='load'); await pg.wait_for_timeout(3000)
    print(await pg.evaluate('''()=>[...document.querySelectorAll('h1')].map(h=>[h.textContent.slice(0,40),getComputedStyle(h).display,h.getBoundingClientRect().height, h.getBoundingClientRect().top])'''))
    print(await pg.evaluate('document.documentElement.scrollWidth'))
    await b.close()
asyncio.run(m())
