const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SPACER, buildIg, checkIg, checkLi, checkAccuracy, buildLi, buildFb, checkFb, FB_CTA, IG_CTA, closingQuestion, validQuestion } = require('../lib/captions');

function words(n, salt) {
  const out = [];
  for (let i = 0; i < n; i++) out.push((salt || 'detail') + (i % 9));
  return out.join(' ');
}

function sample(over) {
  return Object.assign({
    igHook: '🔥 OpenAI just dropped a huge batch of mathematical breakthroughs',
    igParagraphs: [words(22, 'alpha'), words(22, 'beta'), words(22, 'gamma'), words(18, 'delta')],
    liHook: 'OpenAI released hundreds of mathematical solutions from a frontier model.',
    liParagraphs: [words(50, 'one'), words(50, 'two'), words(50, 'three'), words(50, 'four'), words(50, 'five')],
    liTakeaway: 'The release puts automated proof search in the spotlight for every lab.',
    igHashtags: ['OpenAI', 'Mathematics', 'AIResearch', 'Breakthroughs', 'FrontierAI'],
    liHashtags: ['OpenAI', 'Mathematics', 'AIResearch', 'Breakthroughs', 'FrontierAI'],
    outlet: 'The Verge',
    graphicHeadline: 'OPENAI DROPS MATH BREAKTHROUGHS',
    summary: 'OpenAI released hundreds of mathematical solutions from a frontier model this week.',
    category: 'RESEARCH'
  }, over || {});
}

const URL = 'https://www.theverge.com/ai/openai-math?utm_source=tw&utm_medium=social';

test('Instagram caption has one Source line, the URL once, and closes with one question after a spacer', () => {
  const cap = buildIg(sample(), URL);
  const blocks = cap.split('\n' + SPACER + '\n');
  const sourceLines = cap.split('\n').filter(l => l.startsWith('Source:'));
  assert.equal(sourceLines.length, 1);
  assert.equal(sourceLines[0], 'Source: The Verge · https://www.theverge.com/ai/openai-math');
  assert.equal(blocks[blocks.length - 3], sourceLines[0]);
  assert.equal(blocks[blocks.length - 2], '💬 Useful or overhyped?'); // RESEARCH fallback (no igQuestion in the sample)
  assert.equal((cap.match(/https?:\/\//g) || []).length, 1);
  assert.equal(cap.includes('\n\n'), false);
  assert.deepEqual(checkIg(cap, URL), []);
});

test('a second source line or a second URL fails the layout check', () => {
  const cap = buildIg(sample(), URL);
  const doubled = cap.replace('Source: The Verge', 'Source: The Verge') + '\n' + SPACER + '\nSource: The Verge · https://www.example.com/other';
  const errs = checkIg(doubled, URL);
  assert.ok(errs.length > 0);
  const withExtraUrl = cap.replace('mathematical', 'mathematical https://example.com/x');
  assert.ok(checkIg(withExtraUrl, URL).some(e => /URL must appear exactly once/.test(e)));
});

test('LinkedIn caption: source URL once, then the free weekly brief line (newsletter is weekly)', () => {
  const cap = buildLi(sample(), 'https://www.cnbc.com/2026/10/07/story');
  assert.equal((cap.match(/https?:\/\//g) || []).length, 1);
  assert.match(cap, /Source: The Verge · https:\/\/www\.cnbc\.com\/2026\/10\/07\/story\nGet the free weekly AI brief at aifeed\.run\n\n#/);
  assert.equal(/daily/i.test(cap), false);
  assert.deepEqual(checkLi(cap), []);
  assert.ok(checkLi(cap.replace('Get the free weekly AI brief at aifeed.run', 'Get the daily AI brief: https://aifeed.run')).length > 0);
});

test('closing question: the model question when valid, else a category fallback; never daily, follow or links', () => {
  const ig = buildIg(sample({ igQuestion: 'would you let an AI grade your proofs?' }), URL);
  assert.ok(ig.includes('\n' + SPACER + '\n💬 Would you let an AI grade your proofs?\n' + SPACER + '\n'));
  assert.deepEqual(checkIg(ig, URL), []);
  assert.equal(closingQuestion({ igQuestion: 'Follow us for more?', category: 'POLICY' }), 'Ban it or regulate it?');
  assert.equal(closingQuestion({ igQuestion: 'Is this the daily news?', category: 'SAFETY' }), 'Would you trust this?');
  assert.equal(closingQuestion({ igQuestion: 'Agree? Disagree?', category: 'HARDWARE' }), 'Who wins this race?');
  assert.equal(closingQuestion({ igQuestion: 'No question mark here', category: 'nope' }), 'Would you trust this?');
  assert.equal(closingQuestion({ igQuestion: '🤔 Ban it or regulate it?' }), 'Ban it or regulate it?');
  assert.equal(validQuestion('See https://x.com?'), false);
  assert.equal(validQuestion('This is a very long question that goes on and on for far too many words?'), false);
  assert.equal(/daily|follow/i.test(ig + buildFb(ig)), false);
  assert.ok(checkIg(ig.replace('💬 Would you let an AI grade your proofs?', '💬 Follow us daily'), URL).some(e => /closing question/.test(e)));
  // captions posted before the change (newsletter CTA) still pass, so reposts keep working
  const legacy = ig.replace('💬 Would you let an AI grade your proofs?', IG_CTA);
  assert.deepEqual(checkIg(legacy, URL), []);
  assert.deepEqual(checkFb(buildFb(legacy), URL), []);
  assert.equal(FB_CTA, '📩 Free weekly AI brief at aifeed.run/subscribe');
});

test('accuracy gate keeps hedges and dollar signs from the source', () => {
  const src = {
    title: 'DeepSeek considers doubling its funding round to up to $15 billion',
    desc: 'People familiar with the talks say the company is weighing the raise',
    description: '',
    text: 'DeepSeek is considering a round of up to $15 billion.'
  };
  const factual = {
    graphicHeadline: 'DEEPSEEK DOUBLES FUNDING TO 15 BILLION',
    summary: 'DeepSeek doubled its funding round to 15 billion.',
    igHook: '🔥 DeepSeek doubled its funding round to 15 billion'
  };
  const problems = checkAccuracy(factual, src);
  assert.ok(problems.some(p => /hedged/.test(p)));
  assert.ok(problems.some(p => /without \$/.test(p)));
  const hedged = {
    graphicHeadline: 'DEEPSEEK WEIGHS DOUBLING ROUND TO UP TO $15B',
    summary: 'DeepSeek is considering expanding its round to up to $15 billion.',
    igHook: '🔥 DeepSeek weighs doubling its round to up to $15 billion'
  };
  assert.deepEqual(checkAccuracy(hedged, src), []);
});

test('Facebook caption = Instagram caption with the same spacers, Source line once, URL once, no "link in bio"', () => {
  const ig = buildIg(sample({ igQuestion: 'Would you trust this?' }), URL);
  const fb = buildFb(ig);
  const blocks = fb.split('\n' + SPACER + '\n');
  assert.equal(blocks.length, ig.split('\n' + SPACER + '\n').length);
  assert.equal(blocks[blocks.length - 2], '💬 Would you trust this?');
  assert.equal(blocks[blocks.length - 3], 'Source: The Verge · https://www.theverge.com/ai/openai-math');
  assert.equal(fb.split('\n').filter(l => l.startsWith('Source:')).length, 1);
  assert.equal((fb.match(/https?:\/\//g) || []).length, 1);
  assert.equal(/link in bio/i.test(fb), false);
  assert.equal(fb, ig);
  assert.deepEqual(checkFb(fb, URL), []);
  assert.ok(checkFb(buildIg(sample(), URL).replace('💬 Useful or overhyped?', IG_CTA), URL).length > 0, 'an unconverted legacy IG caption must fail the FB check');
  const doubled = fb.replace('\n' + SPACER + '\n💬', '\n' + SPACER + '\nSource: X · https://x.com/a\n' + SPACER + '\n💬');
  assert.ok(checkFb(doubled, URL).some(e => /exactly once/.test(e)));
});
