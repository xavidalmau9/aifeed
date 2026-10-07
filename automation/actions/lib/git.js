const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function assertCommitAllowed(repo) {
  if (process.env.AIFEED_AUTOPILOT_COMMIT !== '1') {
    throw new Error('Refusing to commit: set AIFEED_AUTOPILOT_COMMIT=1 only inside the GitHub Actions post job');
  }
  const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== 'main') throw new Error('Autopilot commits only from main (current branch: ' + branch + ')');
}

/**
 * Reset to origin/main, run mutate() which returns repo-relative paths, commit, push.
 * mutate() may throw SlotTaken; that is not retried.
 */
function commitApply(repo, message, mutate) {
  assertCommitAllowed(repo);
  let last = null;
  for (let i = 1; i <= 5; i++) {
    git(repo, ['fetch', 'origin', 'main']);
    git(repo, ['checkout', 'main']);
    git(repo, ['reset', '--hard', 'origin/main']);
    git(repo, ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    git(repo, ['config', 'user.name', 'aifeed-autopilot']);
    const paths = mutate();
    if (!paths || !paths.length) return;
    git(repo, ['add', '--', ...paths]);
    const staged = git(repo, ['diff', '--cached', '--name-only']).trim();
    if (!staged) return;
    git(repo, ['commit', '-m', message]);
    try {
      git(repo, ['push', 'origin', 'HEAD:main']);
      return;
    } catch (e) {
      last = e;
      console.log('Push rejected, retrying (' + i + '/5): ' + String(e.stderr || e.message || e).slice(0, 300));
    }
  }
  throw new Error('git push failed: ' + String(last && (last.stderr || last.message) || last).slice(0, 500));
}

function readJson(repo, rel, fallback) {
  const p = path.join(repo, rel);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(repo, rel, value) {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
}

module.exports = { git, commitApply, readJson, writeJson, assertCommitAllowed };
