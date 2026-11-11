// Decides whether a fetched AIFeed.run URL is the real story page.
// GitHub Pages serves 404.html ("Page not found") for a slug that is not deployed yet.
// That response is not a successful publish, even when a cache returns HTTP 200.
// ---- article live check ----
function escapeHtmlText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function articlePublicUrl(siteUrl, slug) {
  return String(siteUrl || '').replace(/\/$/, '') + '/news/' + slug + '/';
}

function articleIsLive(status, html, { slug, headline } = {}) {
  if (Number(status) !== 200) return false;
  const body = String(html || '');
  if (/<title>\s*Page not found/i.test(body)) return false;
  if (/<h1>\s*Page not found\s*<\/h1>/i.test(body)) return false;
  const s = String(slug || '');
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(s)) return false;
  if (!body.includes('/news/' + s + '/')) return false;
  if (!body.includes('__AIFEED_SLUG')) return false;
  const head = String(headline || '').trim();
  if (!head) return true;
  const raw = head.slice(0, 80);
  const esc = escapeHtmlText(head).slice(0, 80);
  return body.includes(raw) || body.includes(esc);
}
// ---- end article live check ----

module.exports = { escapeHtmlText, articlePublicUrl, articleIsLive };
