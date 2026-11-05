const test = require('node:test');
const assert = require('node:assert');
const { pollPublic, PUBLIC_WAIT } = require('../lib/net');

test('default public-URL wait is ~25 min, polling every 30-60s', () => {
  const total = PUBLIC_WAIT.firstWaitMs + PUBLIC_WAIT.retryWaitMs * (PUBLIC_WAIT.maxAttempts - 1);
  assert.ok(total >= 24 * 60000 && total <= 26 * 60000, 'total ' + total);
  assert.ok(PUBLIC_WAIT.retryWaitMs >= 30000 && PUBLIC_WAIT.retryWaitMs <= 60000);
});

test('pollPublic keeps polling past 5 min and succeeds when the URL appears', async () => {
  const orig = global.fetch; let calls = 0, slept = 0;
  global.fetch = async () => { calls++; return { status: calls >= 15 ? 200 : 404, arrayBuffer: async () => {} }; };
  try {
    await pollPublic('https://example.test/x.png', { sleepFn: async ms => { slept += ms; } });
    assert.strictEqual(calls, 15);
    assert.ok(slept > 5 * 60000);
  } finally { global.fetch = orig; }
});
