import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Emergency escape hatch: SKIP_HOOKS="<reason>" git commit ...
// The bypass is appended to <git-dir>/hooks-bypass.log; nothing else is changed.
export function bypassIfRequested(hookName) {
  const reason = process.env.SKIP_HOOKS;
  if (!reason) return false;
  const gd = spawnSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' });
  const gitDir = gd.status === 0 ? gd.stdout.trim() : '.git';
  const why = /^(1|true|yes)$/i.test(reason) ? '(no reason given)' : reason;
  appendFileSync(join(gitDir, 'hooks-bypass.log'), `${new Date().toISOString()} ${hookName} bypassed: ${why}\n`);
  console.error(`[${hookName}] checks bypassed via SKIP_HOOKS (logged to ${join(gitDir, 'hooks-bypass.log')}). CI still runs.`);
  return true;
}
