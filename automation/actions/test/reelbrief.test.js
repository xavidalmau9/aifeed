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

// The autopilot "test" job has no numpy/Pillow (they are installed later, in the Reels step), so skip there instead of
// failing the job (a failed test job would skip posting). Locally and in reels-samples.yml these run.
const hasPyDeps = (() => { try { execFileSync('python3', ['-c', 'import numpy, PIL'], { stdio: 'ignore' }); return true; } catch (e) { return false; } })();
test('python scene/punch rules (make_reel scenes.py) pass their offline unit tests', { timeout: 60000, skip: hasPyDeps ? false : 'python3 numpy/Pillow not installed' }, () => {
  const out = execFileSync('python3', ['-m', 'unittest', '-q', 'test_scenes'], { cwd: path.join(__dirname, '../../reels'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ok(true, out);
});
test('python hook-first + voiceover reel (make_reel.py, voice.py) pass their offline unit tests', { timeout: 240000, skip: hasPyDeps ? false : 'python3 numpy/Pillow not installed' }, () => {
  const out = execFileSync('python3', ['-m', 'unittest', '-q', 'test_voice'], { cwd: path.join(__dirname, '../../reels'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ok(true, out);
});

test('choppy quote/first-person punches are rejected', () => {
  const { validPunch, choppyPunch } = require('../lib/reelbrief');
  assert.equal(validPunch('WE WERE WRONG / *LLMS EASIER / TO UNDERSTAND / THAN THOUGHT'), false);
  assert.equal(choppyPunch('"OPEN UP" / *GERMANY / URGES AI'), true);
  assert.equal(validPunch('*LLMS ARE / EASIER TO READ / THAN WE / THOUGHT'), true);
  assert.equal(validPunch('COREWEAVE / *CREDIT SWAPS / HIT DISTRESS / OVER DEBT'), true);
});

test('story waits: first pass short, end-of-run retry ~10-12 min', () => {
  const { STORY_WAIT } = require('../pipeline');
  const mins = w => (w.firstWaitMs + w.retryWaitMs * (w.maxAttempts - 1)) / 60000;
  assert.ok(mins(STORY_WAIT.first) <= 3);
  assert.ok(mins(STORY_WAIT.retry) >= 10 && mins(STORY_WAIT.retry) <= 12);
});

// ---- v3 template: hook A/B/C variants + takeaway (opt-in) ----
{
  const rb = require('../lib/reelbrief');
  const t = require('node:test'); const a = require('node:assert');
  t.test('v3 prompt only when opts.v3', () => {
    const post = { headline: 'Amex cuts staff', summary: 'x', category: 'Business' };
    a.ok(!/hooks/.test(rb.buildReelBriefPrompt(post)));
    a.ok(/hooks/.test(rb.buildReelBriefPrompt(post, { v3: true })));
  });
  t.test('validHook: B must be a question, A/C must not', () => {
    a.ok(rb.validHook('IS AI ALREADY / *COSTING / AMEX JOBS?', 'B'));
    a.ok(!rb.validHook('IS AI ALREADY / *COSTING / AMEX JOBS', 'B'));
    a.ok(!rb.validHook('AMEX CUTS / *5% OF STAFF / FOR AI?', 'A'));
    a.ok(rb.validHook('AMEX CUTS / *5% OF STAFF / TO PREPARE FOR AI', 'A'));
  });
  t.test('parseReelBrief keeps valid hooks + takeaway, drops bad ones', () => {
    const r = rb.parseReelBrief(JSON.stringify({
      hooks: { a: 'AMEX CUTS / *5% OF STAFF / TO PREPARE FOR AI', B: 'not a question / *at all / here' },
      takeaway: 'Big banks are now cutting jobs to fund AI automation.' }));
    a.ok(r.hooks && r.hooks.A && !r.hooks.B);
    a.ok(r.takeaway);
    a.ok(!rb.parseReelBrief(JSON.stringify({ takeaway: 'Our daily pick.' })).takeaway);
  });
}
