// The post job must not claim a slot until ffmpeg actually runs. A cancelled apt install
// used to burn the job timeout and leave the slot claimed after the site publish.
const { execFileSync } = require('child_process');

function assertReelsTools(exec = execFileSync) {
  let out = '';
  try {
    out = exec('ffmpeg', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error('ffmpeg is not installed. Refusing to claim a slot before Reels tools are ready.');
  }
  if (!/ffmpeg version/i.test(String(out))) {
    throw new Error('ffmpeg -version did not report ffmpeg. Refusing to claim a slot.');
  }
}

module.exports = { assertReelsTools };
