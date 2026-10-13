const test = require('node:test');
const assert = require('node:assert');
const { bufferLinkedinText, bufferLinkedinEnabled } = require('../lib/buffer');
test('buffer linkedin text inserts story link above Source', () => {
  const t = bufferLinkedinText('Hook\n\nPara\n\nSource: X · https://x.com/a\nGet the free weekly AI brief at aifeed.run\n\n#A #B', 'https://aifeed.run/news/s/');
  assert.match(t, /Para\n\nRead the full story: https:\/\/aifeed\.run\/news\/s\/\n\nSource:/);
  assert.doesNotMatch(t, /daily/i);
});
test('buffer linkedin disabled without key', () => {
  assert.equal(bufferLinkedinEnabled({ bufferLinkedinEnabled: true, bufferLinkedinChannelId: '6ace69ec778b240e2ffa52a9' }, {}), false);
  assert.equal(bufferLinkedinEnabled({ bufferLinkedinEnabled: true, bufferLinkedinChannelId: '6ace69ec778b240e2ffa52a9' }, { BUFFER_API_KEY: 'k' }), true);
});
