const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { selectFresh } = require('../lib/rss');
const { assemblePublish } = require('../lib/quality');
const { comparePrints } = require('../lib/visual');
const {
  articleImageUrls, imageVariants, parsePhotoVerdict, buildPhotoJudgePrompt,
  refinePhotos, loadRecentPrints, applyPhotoBackfill
} = require('../lib/photos');

const IMAGES = path.join(__dirname, '../../../images');

function print(hex) {
  return { dhash: hex, phash: hex, hist: null };
}

function loaded(hex, extra) {
  return Object.assign({
    ok: true,
    print: print(hex),
    generic: false,
    genericReason: '',
    preview: Buffer.from('jpeg'),
    width: 1200,
    height: 630
  }, extra || {});
}

test('article images keep the lead photo and skip avatars, logos, and other headlines', () => {
  const html = `<html><head>
<script type="application/ld+json">{"@type":"NewsArticle","image":["https://cdn.example.com/hero.jpg?w=1200"]}</script>
</head><body>
<div class="duet--layout--entry-image"><img alt="STK155_OPEN_AI" src="https://cdn.example.com/hero.jpg?w=2400" width="2400" height="1350"></div>
<figure><img alt="Researchers at the lab" src="https://cdn.example.com/lab-photo.jpg" srcset="https://cdn.example.com/lab-photo.jpg 800w, https://cdn.example.com/lab-photo.jpg?w=1600 1600w"></figure>
<a href="/authors/jane"><img alt="Jane Doe" src="https://cdn.example.com/author_profile/jane.jpg" width="96" height="96"></a>
<div class="duet--content-cards--content-card"><img alt="A totally different headline about gardening tools and weather balloons" src="https://cdn.example.com/other-story.jpg?w=2400" width="1200" height="800"></div>
<img src="https://cdn.example.com/pixel.gif" width="1" height="1">
<img alt="mark" src="https://cdn.example.com/brand/logo.png" width="800" height="400">
</body></html>`;
  const urls = articleImageUrls(html, 'https://www.theverge.com/story', 'OpenAI doubles down on decision to fire three researchers').map(i => i.url);
  assert.ok(urls.some(u => u.includes('hero.jpg')));
  assert.ok(urls.some(u => u.includes('lab-photo.jpg') && u.includes('1600')));
  assert.equal(urls.some(u => u.includes('author_profile') || u.includes('other-story') || u.includes('pixel') || u.includes('logo.png')), false);
});

test('author headshots and related-story cards stay out even when the marker is far from the img', () => {
  const pad = '<img alt="previous card" src="https://cdn.example.com/prev.jpg?w=2400" srcset="' + ('https://cdn.example.com/prev.jpg?w=100 100w, ').repeat(40) + '">';
  const html = `<html><body>
<div class="duet--layout--entry-image"><img alt="STK155_OPEN_AI" src="https://cdn.example.com/hero.jpg?w=2400" width="2400" height="1350" sizes="(max-width: 768px) 100vw, 700px"></div>
<div class="duet--article--article-byline"><a href="/authors/robert-hart"><span>Robert Hart</span></a>
<aside id="popover-author_byline_lead"><div><img alt="Robert Hart" sizes="125px" src="https://cdn.example.com/ROB_H_BLURPLE.jpg?w=2400" srcset="https://cdn.example.com/ROB_H_BLURPLE.jpg?w=2400 2400w"></div></aside></div>
<div class="duet--layout--article-recirc"><h2>More in AI</h2>${pad}
<div class="duet--content-cards--content-card"><img alt="Pure insanity: Mathematicians will need years to make sense of OpenAI latest drop" sizes="(max-width: 768px) 100vw, 640px" src="https://cdn.example.com/STKS537_AI_MATH_5.jpg?w=2400" width="2400" height="1350"></div></div>
<div class="SummaryCollectionGridItems"><a class="summary-item__image-link" href="https://www.wired.com/story/other"><img alt="AI Is Getting Really Good at Messing With Cybercriminals" src="https://cdn.example.com/photos/abc/16:9/w_640,c_limit/undefined"></a></div>
<figure><img alt="Researchers at the lab" src="https://cdn.example.com/lab-photo.jpg?w=1600" width="1600" height="900"></figure>
</body></html>`;
  const urls = articleImageUrls(html, 'https://www.theverge.com/story', 'USA Today becomes the latest publisher to sue OpenAI').map(i => i.url);
  assert.ok(urls.some(u => u.includes('hero.jpg')));
  assert.ok(urls.some(u => u.includes('lab-photo.jpg')));
  assert.equal(urls.some(u => /BLURPLE|AI_MATH|undefined|prev\.jpg/.test(u)), false);
});

test('a cropped CDN url has an uncropped variant and a plain url does not', () => {
  const variants = imageVariants('https://cdn.example.com/a.jpg?quality=90&crop=0%2C10%2C100%2C80&w=1200');
  assert.equal(variants.length, 1);
  assert.equal(new URL(variants[0]).searchParams.has('crop'), false);
  assert.equal(new URL(variants[0]).searchParams.get('w'), '1200');
  assert.deepEqual(imageVariants('https://cdn.example.com/a.jpg?w=1200'), []);
});

test('photo verdict parser accepts the judge JSON and rejects anything else', () => {
  const v = parsePhotoVerdict('```json\n{"kind":"logo-card","matches":false,"reason":"OpenAI knot on a purple field"}\n```');
  assert.equal(v.kind, 'logo-card');
  assert.equal(v.matches, false);
  assert.match(buildPhotoJudgePrompt('Headline', 'Story text'), /logo-card/);
  assert.equal(parsePhotoVerdict('not json'), null);
  assert.equal(parsePhotoVerdict('{"kind":"pretty","matches":true}'), null);
});

test('a duplicate og:image is dropped and an in-article photo is used', async () => {
  const recent = [{ headline: 'OpenAI doubles down on the firing', dhash: 'aaaaaaaaaaaaaaaa', phash: 'aaaaaaaaaaaaaaaa', hist: null }];
  const loadImage = async url => {
    if (url.includes('og.jpg')) return loaded('aaaaaaaaaaaaaaaa');
    if (url.includes('lab.jpg')) return loaded('1111111111111111');
    return { ok: false, reason: 'missing' };
  };
  const [story] = [{
    linkOk: true,
    title: 'USA Today sues OpenAI over copied articles',
    ogImage: 'https://cdn.example.com/og.jpg',
    inlineImages: [{ url: 'https://cdn.example.com/lab.jpg', width: 1600 }],
    alts: []
  }];
  const out = await refinePhotos([story], { recent, loadImage, judge: null });
  assert.equal(story.photoOk, true);
  assert.equal(story.ogImage, 'https://cdn.example.com/lab.jpg');
  assert.equal(story.photoSource, 'in-article image');
  assert.match(out.lines.join('\n'), /near-duplicate of "OpenAI doubles down/);
  assert.match(out.lines.join('\n'), /photo choose:/);
});

test('logo cards are skipped, then another outlet photo is chosen', async () => {
  const loadImage = async url => {
    if (url.includes('knot')) return loaded('2222222222222222', { generic: true, genericReason: 'stock logo filename' });
    if (url.includes('wordmark')) return loaded('3333333333333333', { generic: true, genericReason: 'flat brand graphic' });
    if (url.includes('wired')) return loaded('4444444444444444');
    return { ok: false, reason: 'missing' };
  };
  const story = {
    linkOk: true,
    title: 'Anthropic AI gave police a fake homicide tip',
    link: 'https://www.theverge.com/anthropic-tip',
    ogImage: 'https://cdn.example.com/knot.jpg',
    inlineImages: [{ url: 'https://cdn.example.com/wordmark.jpg', width: 1600 }],
    alts: [{ title: 'Anthropic AI gave police a fake homicide tip', link: 'https://www.wired.com/anthropic-tip', source: 'wired.com' }]
  };
  const out = await refinePhotos([story], {
    recent: [],
    loadImage,
    fetchArticle: async () => ({ og: 'https://cdn.example.com/wired-photo.jpg', inline: [] })
  });
  assert.equal(story.photoOk, true);
  assert.equal(story.photoSource, 'other outlet (wired.com) og:image');
  assert.match(out.lines.join('\n'), /generic brand\/logo art/);
  assert.match(out.lines.join('\n'), /other outlet \(wired.com\)/);
});

test('vision can reject a logo the local check missed, and a story photo is kept', async () => {
  const loadImage = async url => loaded(url.includes('og') ? '5555555555555555' : '6666666666666666');
  const story = {
    linkOk: true,
    title: 'OpenAI releases a stack of math papers',
    ogImage: 'https://cdn.example.com/og.jpg',
    inlineImages: [{ url: 'https://cdn.example.com/sam.jpg', width: 1600 }],
    alts: []
  };
  const seen = [];
  await refinePhotos([story], {
    recent: [],
    loadImage,
    judge: async (jpeg, meta) => {
      seen.push(meta.url);
      if (String(meta.url).includes('og')) return { kind: 'logo-card', matches: false, reason: 'OpenAI knot' };
      return { kind: 'story-photo', matches: true, reason: 'Sam Altman at the event' };
    }
  });
  assert.deepEqual(seen, ['https://cdn.example.com/og.jpg', 'https://cdn.example.com/sam.jpg']);
  assert.equal(story.ogImage, 'https://cdn.example.com/sam.jpg');
  assert.match(story.photoWhy, /Sam Altman/);
});

test('when every photo is a logo the story is skipped for the next candidate', async () => {
  const bad = { linkOk: true, title: 'OpenAI logo story', ogImage: 'https://cdn.example.com/a.jpg', inlineImages: [], alts: [] };
  const good = { linkOk: true, title: 'Book publishers revolt over AI', ogImage: 'https://cdn.example.com/b.jpg', inlineImages: [], alts: [] };
  let n = 0;
  const load = async url => {
    n++;
    if (url.endsWith('a.jpg')) return loaded('8888888888888888', { generic: true, genericReason: 'flat brand graphic' });
    return loaded('9999999999999999');
  };
  const out = await refinePhotos([bad, good], { recent: [], loadImage: load });
  assert.equal(bad.photoOk, false);
  assert.match(bad.photoProblem, /generic brand/);
  assert.equal(good.photoOk, true);
  assert.match(out.lines.join('\n'), /next story/);
  assert.ok(n >= 2);
});

test('an uncropped variant of the same file counts as a recent graphic', async () => {
  const recent = [{ headline: 'OpenAI doubles down on the firing', dhash: 'abcdefabcdefabcd', phash: 'abcdefabcdefabcd', hist: null }];
  const story = {
    linkOk: true,
    title: 'USA Today sues OpenAI',
    ogImage: 'https://cdn.example.com/STK155_OPEN_AI.jpg?crop=1&w=1200',
    inlineImages: [],
    alts: []
  };
  const loadImage = async url => {
    if (url.includes('crop=')) return loaded('1234567890abcdef');
    return loaded('abcdefabcdefabcd');
  };
  await refinePhotos([story], { recent, loadImage });
  assert.equal(story.photoOk, false);
  assert.match(story.photoLog.join('\n'), /uncropped source/);
});

test('backfill fingerprints the rendered cards and the publish entry keeps the new one', async () => {
  const history = {
    posted: [
      { headline: 'OpenAI doubles down on decision to fire three AI safety researchers', image: 'aifeed_openai-doubles-down-on-decision-to_20261009_am.png' },
      { headline: 'USA Today becomes the latest publisher to sue OpenAI', image: 'aifeed_usa-today-becomes-the-latest-publisher_20261009_pm.png' },
      { headline: 'Microsoft is giving Copilot more control over Windows and your files', image: 'aifeed_microsoft-is-giving-copilot-more-control_20261008_am.png' }
    ]
  };
  const { prints, backfill } = await loadRecentPrints({ history, posts: [], imagesDir: IMAGES, limit: 14 });
  assert.equal(prints.length, 3);
  assert.equal(backfill.length, 3);
  assert.equal(comparePrints(prints[0], prints[1]).near, true);
  assert.equal(comparePrints(prints[0], prints[2]).near, false);
  const stamped = applyPhotoBackfill(JSON.parse(JSON.stringify(history)), backfill);
  assert.equal(stamped.posted[0].photo.via, 'backfill');
  assert.equal(stamped.posted[0].photo.dhash, prints[0].dhash);
  const again = await loadRecentPrints({ history: stamped, posts: [], imagesDir: IMAGES, limit: 14 });
  assert.equal(again.backfill.length, 0);
  assert.equal(again.prints[0].from, 'history');

  const published = assemblePublish({
    story: {
      title: 'Book publishers are quietly using more AI',
      link: 'https://www.wired.com/story/book-publishers',
      canonUrl: 'wired.com/story/book-publishers',
      ogImage: 'https://media.wired.com/photo.jpg',
      photoSource: 'og:image',
      photoFingerprint: { dhash: '0123456789abcdef', phash: 'fedcba9876543210', hist: [10, 20] }
    },
    gen: { summary: 'Publishers are using more AI and staff are pushing back hard.', igCaption: '🚀 Hook\n\n#AI #Books' },
    category: 'BUSINESS',
    liCaption: 'LinkedIn caption',
    liWarning: null,
    today: '2026-10-10',
    slot: 1,
    siteUrl: 'https://aifeed.run'
  });
  assert.equal(published.historyEntry.photo.dhash, '0123456789abcdef');
  assert.equal(published.historyEntry.photo.via, 'og:image');
  assert.equal(published.historyEntry.image.endsWith('.png'), true);
});

test('same-story outlets stay attached when a duplicate headline is collapsed', () => {
  const hist = [{ src: 'site', title: 'Old story', canon: 'cnbc.com/a', url: 'https://www.cnbc.com/a', date: '2026-09-01' }];
  const items = [
    { title: 'Robot cooks open a downtown cafe in Austin this week', link: 'https://www.theverge.com/robot-cooks-austin-cafe', source: 'theverge.com' },
    { title: 'Robot cooks open a downtown cafe in Austin this week', link: 'https://www.wired.com/robot-cooks-austin-cafe-again', source: 'wired.com' }
  ];
  const { fresh, skipped } = selectFresh(items, hist);
  assert.equal(skipped.length, 0);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].alts.length, 1);
  assert.equal(fresh[0].alts[0].source, 'wired.com');
  assert.equal(fs.existsSync(IMAGES), true);
});
