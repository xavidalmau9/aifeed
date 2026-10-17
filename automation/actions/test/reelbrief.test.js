const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildReelBriefPrompt, parseReelBrief, validPunch, reelBrief } = require('../lib/reelbrief');

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
  const b = parseReelBrief('Sure:\n{"punch": "CoreWeave / credit stress / *hits distress / levels", "scene": "a stressed trader in shadow before red crashing charts", "keywords": ["stock market crash screen", "trading floor"]}');
  assert.equal(b.punch, 'COREWEAVE / CREDIT STRESS / *HITS DISTRESS / LEVELS');
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

test('LLM failure never blocks the Reel (empty brief)', async () => {
  assert.deepEqual(await reelBrief(post, async () => { throw new Error('HTTP 529'); }), {});
});

test('python scene/punch rules (make_reel scenes.py) pass their offline unit tests', { timeout: 60000 }, () => {
  const out = execFileSync('python3', ['-m', 'unittest', '-q', 'test_scenes'], { cwd: path.join(__dirname, '../../reels'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ok(true, out);
});
