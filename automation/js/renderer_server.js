// Gotenberg-compatible subset: POST /forms/chromium/screenshot/html (multipart: files=index.html, width, height, format, waitDelay)
// Text-fit: if the page sets window.__fitReport with ok=false, returns HTTP 422 instead of an image.
const http = require('http'); const Busboy = require('busboy'); const puppeteer = require('puppeteer-core');
const PORT = process.env.RENDER_PORT || 3000; let browser;
async function getBrowser() {
  if (browser && browser.connected) return browser;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
  return browser;
}
http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.end('{"status":"up"}'); return; }
  if (req.method !== 'POST' || !req.url.startsWith('/forms/chromium/screenshot/html')) { res.statusCode = 404; res.end('not found'); return; }
  const fields = {}; let html = '';
  const bb = Busboy({ headers: req.headers, limits: { fileSize: 5e6 } });
  bb.on('field', (k, v) => fields[k] = v);
  bb.on('file', (n, f) => { const c = []; f.on('data', d => c.push(d)); f.on('end', () => { html = Buffer.concat(c).toString('utf8'); }); });
  bb.on('close', async () => {
    let page;
    try {
      if (!html) throw new Error('no index.html');
      const w = parseInt(fields.width || 1080), h = parseInt(fields.height || 1350), delay = parseInt(fields.waitDelay || '2') * 1000;
      page = await (await getBrowser()).newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
      await page.evaluate(() => document.fonts.ready);
      await new Promise(r => setTimeout(r, delay));
      const fit = await page.evaluate(() => window.__fitReport || null);
      if (fit && !fit.ok) { res.writeHead(422, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'text-fit check failed', fit })); return; }
      if (fit) res.setHeader('X-Fit-Report', JSON.stringify(fit));
      const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png);
    } catch (e) { res.statusCode = 500; res.end('render error: ' + e.message); }
    finally { if (page) page.close().catch(() => {}); }
  });
  req.pipe(bb);
}).listen(PORT, '127.0.0.1', () => console.log('renderer on 127.0.0.1:' + PORT));
