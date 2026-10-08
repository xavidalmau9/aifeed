// Validates the rendered PNG and prepares GitHub commits (image, posts-index.json, history.json).
const cfg = $('Config').first().json;
const q = $('Quality Checks + Build HTML').first().json;
const base = $('Fetch RSS + Dedup').first().json;
const buf = await this.helpers.getBinaryDataBuffer(0, 'png');
const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
if (!isPng || w !== 1080 || h !== 1350 || buf.length < 60000) throw new Error(`Rendered image invalid (png=${isPng}, ${w}x${h}, ${buf.length} bytes)`);
if (buf.length > 8 * 1024 * 1024) throw new Error('PNG over 8MB Instagram limit');

const { story, gen, category } = q;
let liCaption = gen.liCaption, liWarning = q.liShort ? `LinkedIn caption short (${q.liWords} words)` : null;
try { const m = $('Merge LI Caption').first().json; liCaption = m.liCaption; liWarning = m.liWarning; } catch (e) { /* no retry was needed */ }
if (liCaption.length > 2950) { liCaption = liCaption.slice(0, 2950).replace(/\s+\S*$/, '') + '…'; liWarning = (liWarning ? liWarning + '; ' : '') + 'LinkedIn caption trimmed to 3000 chars'; }
const slug = story.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(x => x.length >= 2).slice(0, 6).join('-');
const stamp = cfg.today.replace(/-/g, '');
const pngName = `aifeed_${slug}_${stamp}_${cfg.slot === 1 ? 'am' : 'pm'}.png`;
const nowIso = new Date().toISOString();
const toHtml = cap => cap.split(/\n\n+/).map(p => p.trim()).filter(p => p && !/^Source:/i.test(p) && !/^https?:/.test(p) && !/^Get the (free )?(daily|weekly)/i.test(p) && !/^#\w/.test(p)).map(p => '<p>' + p.replace(/\n/g, ' ') + '</p>').join('\n');
const post = {
  id: slug + '-' + stamp, slug, headline: story.title, summary: gen.summary,
  body: toHtml(liCaption), category: category.charAt(0) + category.slice(1).toLowerCase(),
  imageUrl: `${cfg.siteUrl}/images/${pngName}`, image: `images/${pngName}`,
  sourceUrl: story.link, publishedAt: nowIso, hashtags: (gen.igCaption.match(/#(\w+)/g) || []).map(t => t.slice(1)), isVideo: false
};
const posts = [post, ...(base.posts || [])];
const history = q.history;
history.posted.unshift({ postedAt: nowIso, date: cfg.today, slot: cfg.slot, headline: story.title, canonUrl: story.canonUrl, url: story.link, slug, image: pngName });
history.posted = history.posted.slice(0, 2000);
const b64 = o => Buffer.from(JSON.stringify(o, null, 2)).toString('base64');
return [{ json: { pngName, pngBase64: buf.toString('base64'), post, igCaption: gen.igCaption, liCaption, liWarning, postsBase64: b64(posts), postsSha: base.postsSha, historyBase64: b64(history), historySha: base.historySha } }];
