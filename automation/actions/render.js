// Inline HTML → PNG. Same viewport, font wait, text-fit gate, and clip as renderer/server.js.
// A page that sets window.__fitReport.ok = false is rejected (the server returns HTTP 422).
const puppeteer = require('puppeteer-core');

function chromePath() {
  return process.env.CHROME_PATH || '/usr/bin/google-chrome';
}

let browser;

async function getBrowser() {
  if (browser && browser.connected) return browser;
  // Chrome sometimes starts slowly on a fresh runner ("Timed out ... WS endpoint", Oct 8): 90s timeout, 3 tries.
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      browser = await puppeteer.launch({
        executablePath: chromePath(),
        headless: true,
        timeout: 90000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars']
      });
      return browser;
    } catch (e) {
      last = e;
      console.log('Chrome launch failed (try ' + (i + 1) + '/3): ' + String(e && e.message || e).slice(0, 160));
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  throw last;
}

async function renderHtml(html, { width = 1080, height = 1350, waitMs = 3000 } = {}) {
  const page = await (await getBrowser()).newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    const fit = await page.evaluate(() => window.__fitReport || null);
    if (fit && !fit.ok) {
      const err = new Error('text-fit check failed: ' + (fit.notes || []).join('; '));
      err.statusCode = 422;
      err.fit = fit;
      throw err;
    }
    const png = Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } }));
    return { png, fit };
  } finally {
    await page.close().catch(() => {});
  }
}

async function closeBrowser() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

module.exports = { renderHtml, closeBrowser, chromePath };
