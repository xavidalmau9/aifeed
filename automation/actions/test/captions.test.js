const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SPACER, buildIg, checkIg, checkLi, checkAccuracy, buildLi } = require('../lib/captions');

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

test('Instagram caption has one Source line, the URL once, and a spacer before the brief', () => {
  const cap = buildIg(sample(), URL);
  const blocks = cap.split('\n' + SPACER + '\n');
  const sourceLines = cap.split('\n').filter(l => l.startsWith('Source:'));
  assert.equal(sourceLines.length, 1);
  assert.equal(sourceLines[0], 'Source: The Verge · https://www.theverge.com/ai/openai-math');
  assert.equal(blocks[blocks.length - 3], sourceLines[0]);
  assert.equal(blocks[blocks.length - 2], '📩 Free daily AI brief → link in bio');
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

test('LinkedIn caption keeps the source URL and the site link on separate spacing', () => {
  const cap = buildLi(sample(), 'https://www.cnbc.com/2026/10/07/story');
  assert.equal((cap.match(/https?:\/\//g) || []).length, 2);
  assert.match(cap, /Source: The Verge · https:\/\/www\.cnbc\.com\/2026\/10\/07\/story\nGet the daily AI brief: https:\/\/aifeed\.run/);
  assert.deepEqual(checkLi(cap), []);
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
