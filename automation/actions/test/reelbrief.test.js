const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildReelBriefPrompt, parseReelBrief, validPunch, repeatedRoots, reelBrief } = require('../lib/reelbrief');

const post = { headline: 'CoreWeave credit default swaps hit distress levels as investors sour on AI debt', category: 'Business',
  summary: "CoreWeave's credit default swaps surged to distress levels amid concerns over its $51 billion debt load." };

test('brief prompt carries the story and the hard rules', () => {
  const p = buildReelBriefPrompt(post);
  assert.match(p, /CoreWeave credit default swaps/);
  assert.match(p, /exactly ONE line with "\*"/);
  assert.match(p, /no real identifiable people/);
  assert.match(p, /never use the word "daily"/);
});

test('valid LLM brief is parsed and normalized', () => {
  const b = parseReelBrief('Sure:\n{"punch": "CoreWeave / credit swaps / *hit distress / over debt", "scene": "a stressed trader in shadow before red crashing charts", "keywords": ["stock market crash screen", "trading floor"]}');
  assert.equal(b.punch, 'COREWEAVE / CREDIT SWAPS / *HIT DISTRESS / OVER DEBT');
  assert.match(b.scenePrompt, /stressed trader/);
  assert.deepEqual(b.sceneKeywords, ['stock market crash screen', 'trading floor']);
});

test('invalid punches are dropped (no accent, two accents, too many lines, banned word)', () => {
  assert.equal(validPunch('A / B / C'), false);
  assert.equal(validPunch('*A / *B / C'), false);
  assert.equal(validPunch('A / B / C / D / *E'), false);
  assert.equal(validPunch('YOUR / *DAILY / AI NEWS'), false);
  assert.equal(validPunch('A / *B'), true);
  assert.deepEqual(parseReelBrief('{"punch": "NO ACCENT / HERE / AT ALL"}'), {});
  assert.deepEqual(parseReelBrief('not json'), {});
});

test('punches that repeat a root word are rejected (stress/distress, AI/AI)', () => {
  assert.deepEqual(repeatedRoots('COREWEAVE / CREDIT STRESS / *HITS DISTRESS / LEVELS'), ['DISTRESS']);
  assert.deepEqual(repeatedRoots('AI MODELS / *AI FAILS / GENOMES'), ['AI']);
  assert.deepEqual(repeatedRoots('NVIDIA / *TAGS / TAGGED'), ['TAGGED']);
  assert.equal(validPunch('COREWEAVE / CREDIT STRESS / *HITS DISTRESS / LEVELS'), false);
  assert.equal(validPunch('AI MODELS / *AI FAILS'), false);
  for (const ok of ['COREWEAVE / *CREDIT SWAPS / HIT DISTRESS / OVER DEBT', 'OPENAI EMPLOYEE / *ARRESTED FOR / HIDDEN DEVICE / IN BOARDROOM',
    'YOUTUBE MUSIC / *TAGS AI-MADE / SONGS WITH / NEW LABELS', 'AI MODELS / LACK DATA / *CAN\'T DECODE / HUMAN GENES']) assert.equal(validPunch(ok), true, ok);
  assert.equal(parseReelBrief('{"punch": "AI MODELS / *AI FAILS"}').punch, undefined);
});

test('brief prompt forbids repetition and text-prone scene objects', () => {
  const p = buildReelBriefPrompt(post);
  assert.match(p, /Never repeat a word or its root/);
  assert.match(p, /lecterns, podiums/);
  assert.doesNotMatch(p, /CREDIT STRESS \/ \*HITS DISTRESS/);
});

test('repeated-root punch triggers one retry, then the retry punch is used', async () => {
  const asks = [];
  const b = await reelBrief(post, async prompt => {
    asks.push(prompt);
    return asks.length === 1
      ? '{"punch": "COREWEAVE / CREDIT STRESS / *HITS DISTRESS / LEVELS", "scene": "a stressed trader before red crashing lines", "keywords": ["a"]}'
      : '{"punch": "COREWEAVE / *CREDIT SWAPS / HIT DISTRESS / OVER DEBT"}';
  });
  assert.equal(asks.length, 2);
  assert.match(asks[1], /repeated the root word\(s\) DISTRESS/);
  assert.equal(b.punch, 'COREWEAVE / *CREDIT SWAPS / HIT DISTRESS / OVER DEBT');
  assert.match(b.scenePrompt, /stressed trader/);
});

test('if the retry still repeats, no punch is returned (make_reel.py uses the rule-based punch)', async () => {
  let n = 0;
  const b = await reelBrief(post, async () => { n++; return '{"punch": "AI MODELS / *AI FAILS", "scene": "a glowing DNA helix in a dark lab"}'; });
  assert.equal(n, 2);
  assert.equal(b.punch, undefined);
  assert.match(b.scenePrompt, /DNA helix/);
});

test('a valid punch on the first try makes exactly one call', async () => {
  let n = 0;
  const b = await reelBrief(post, async () => { n++; return '{"punch": "COREWEAVE / *CREDIT SWAPS / HIT DISTRESS"}'; });
  assert.equal(n, 1); assert.ok(b.punch);
});

test('LLM failure never blocks the Reel (empty brief)', async () => {
  assert.deepEqual(await reelBrief(post, async () => { throw new Error('HTTP 529'); }), {});
});

test('python scene/punch rules (make_reel scenes.py) pass their offline unit tests', { timeout: 60000 }, () => {
  const out = execFileSync('python3', ['-m', 'unittest', '-q', 'test_scenes'], { cwd: path.join(__dirname, '../../reels'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ok(true, out);
});
