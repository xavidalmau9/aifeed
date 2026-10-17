// Sample renderer for review: runs the SAME automatic path as the autopilot (Reel brief on the existing model ->
// make_reel scene cascade incl. Workers AI -> cover + mp4) for recent stories. It has no posting code at all and is run
// by .github/workflows/reels-samples.yml, which receives no Meta/LinkedIn/Buffer secrets.
const fs = require('fs');
const path = require('path');
const R = path.resolve(__dirname, '../..');
const { renderReel } = require(R + '/automation/actions/lib/reels');
const { reelBrief } = require(R + '/automation/actions/lib/reelbrief');
const { claudeMessage } = require(R + '/automation/actions/lib/net');
const cfg = JSON.parse(fs.readFileSync(R + '/automation/actions/config.json'));

const OUT = process.env.SAMPLES_OUT || path.join(R, 'reel-samples');
fs.mkdirSync(OUT, { recursive: true });
process.env.AIFEED_SCENE_DEBUG = process.env.AIFEED_SCENE_DEBUG || path.join(OUT, 'raw');
const posts = JSON.parse(fs.readFileSync(R + '/_posts/posts-index.json'));
const history = JSON.parse(fs.readFileSync(R + '/_data/history.json')).posted || [];
const want = (process.env.SAMPLE_SLUGS || '').split(',').map(s => s.trim()).filter(Boolean);
const list = want.length ? want.map(s => posts.find(p => p.slug === s)).filter(Boolean) : posts.slice(0, Number(process.env.SAMPLE_COUNT || 4));

(async () => {
  const log = [];
  for (const p of list) {
    const h = history.find(x => x.slug === p.slug);
    const photo = (h && h.photo && h.photo.url) || '';
    let brief = {};
    if (process.env.ANTHROPIC_API_KEY) {
      brief = await reelBrief(p, prompt => claudeMessage(process.env.ANTHROPIC_API_KEY, { model: cfg.anthropicModel, prompt, maxTokens: 400, temperature: 0.4, tries: 2 }));
    }
    try {
      const rr = renderReel(R, Object.assign({}, p, brief), path.join(R, p.image), photo);
      fs.copyFileSync(rr.mp4, path.join(OUT, p.slug + '.mp4'));
      if (rr.cover) fs.copyFileSync(rr.cover, path.join(OUT, p.slug + '_cover.jpg'));
      log.push({ slug: p.slug, category: p.category, brief, punch: rr.punch, scene: rr.sceneSource, sceneLog: rr.sceneLog, credit: rr.credit });
    } catch (e) {
      log.push({ slug: p.slug, error: String(e.message).slice(0, 300) });
    }
    console.log(JSON.stringify(log[log.length - 1]));
  }
  fs.writeFileSync(path.join(OUT, 'run-log.json'), JSON.stringify(log, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
