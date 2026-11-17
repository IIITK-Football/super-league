// Group: tooling. The Claude Code guard (scripts/work/claude-guard.mjs) runs before every Bash, Edit and Write tool call.
// It is deterministic: the agent cannot argue with it. This table is the contract. Every bypass named in the workflow
// must be denied, the owner-only steps must be denied to the agent, and ordinary work must stay allowed (a guard that
// blocks normal work gets disabled).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import { decideBash, decideEdit } from '../../../scripts/work/claude-guard.mjs';

const root = join(__dirname, '../../..');
// The base branch of a pull request is looked up through gh in real use; tests inject it.
const bash = (command: string, prBase: () => string | null = () => null) => decideBash(command, { prBase }).decision as string;
const edit = (file: string) => decideEdit(file, { root: '/repo' }).decision as string;

describe('Bash: bypasses and unsafe Git are denied', () => {
  const denied = [
    'git commit --no-verify -m "x"',
    'git commit -nm "x"',
    'git commit -n -m x',
    'git push --no-verify origin ready/x',
    'SKIP_HOOKS=1 git commit -m "x"',
    'HUSKY=0 git commit -m x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git config core.hooksPath /tmp/none',
    'git config --local --unset core.hooksPath',
    'git push --force origin ready/x',
    'git push -f origin ready/x',
    'git push --force-with-lease',
    'git push origin main',
    'git push origin :ready/old',
    'git push --delete origin ready/old',
    'git reset --hard HEAD~3',
    'git clean -fd',
    'git checkout -- .',
    'git checkout main',
    'git checkout HEAD~1 -- tests/groups.json',
    'git switch main',
    'git restore src/a.ts',
    'git stash drop',
    'git branch -D develop',
    'cd /tmp && SKIP_HOOKS=yes git commit -m x',
    'echo hi; git push --force',
  ];
  for (const c of denied) it(`denies: ${c}`, () => expect(bash(c)).toBe('deny'));
});

describe('Bash: GitHub changes belong to the owner', () => {
  const denied = [
    'gh pr merge 12 --squash',
    'gh pr review 12 --approve',
    'gh api repos/o/r/rulesets --method POST --input r.json',
    'gh api repos/o/r/actions/secrets/X -X DELETE',
    'gh api -f name=x repos/o/r/environments/e',
    'gh secret set SUPABASE_DB_PASSWORD',
    'gh variable set X --body 1',
    'gh repo edit --visibility private',
    'gh auth refresh -s workflow',
    'gh auth token',
    'gh auth status --show-token',
  ];
  for (const c of denied) it(`denies: ${c}`, () => expect(bash(c)).toBe('deny'));
  it('asks before triggering a workflow (a hosted action)', () => expect(bash('gh workflow run db-deploy.yml')).toBe('ask'));

  it('puts a change to an existing ruleset to the owner as a confirmation, and still denies creating or deleting rulesets', () => {
    expect(bash('gh api repos/o/r/rulesets/27461038 -X PUT --input r.json')).toBe('ask');
    expect(bash('gh api --method PUT repos/o/r/rulesets/27461038 --input r.json')).toBe('ask');
    expect(bash('gh api repos/o/r/rulesets --method POST --input r.json')).toBe('deny');
    expect(bash('gh api repos/o/r/rulesets/27461038 -X DELETE')).toBe('deny');
  });
});

describe('Bash: merging pull requests', () => {
  it('is allowed into develop (the integration branch the required gate already protects)', () => {
    expect(bash('gh pr merge 12 --rebase', () => 'develop')).toBe('allow');
    expect(bash('gh pr merge --rebase --delete-branch', () => 'develop')).toBe('allow');
  });

  it('stays the owner\'s for main (it triggers the production workflow) and when the base cannot be determined', () => {
    expect(bash('gh pr merge 12 --rebase', () => 'main')).toBe('deny');
    expect(bash('gh pr merge 12 --rebase', () => null)).toBe('deny');
    expect(bash('gh pr merge 12 --admin --rebase', () => 'develop')).toBe('deny'); // never override the gate
  });
});

describe('Bash: what a command really writes, not the words in it', () => {
  const allowed = [
    // data written by cat/tee is not code, even if it names protected paths
    'cat >> backend/tests/tooling/x.test.ts <<\'EOF\'\nexpect(existsSync(join(root, "backlog/evidence/SL-100.json"))).toBe(true);\nEOF',
    // quoted text in a commit message is only text
    'git add backlog/evidence/SL-018.json && git commit -m "feat: x" -m "Co-Authored-By: A <a@b.c>"',
    'git commit -m "explain that work attest and cli.mjs approve are owner-only"',
    'echo "do not write backlog/approvals/x.json by hand"',
    // an interpreter script that edits ordinary files may mention the owner commands in its text
    'python3 - <<\'EOF\'\np="scripts/work/cli.mjs"\ns=open(p).read().replace("approve","attest")\nopen(p,"w").write(s)\nEOF',
    // a redirect to an ordinary file
    'node scripts/test-groups.mjs list > /tmp/groups.txt 2>&1',
  ];
  for (const c of allowed) it(`allows: ${c.split('\n')[0]}`, () => expect(bash(c)).toBe('allow'));

  const denied = [
    'cat > backlog/evidence/SL-018.json <<\'EOF\'\n{}\nEOF',
    'echo {} >> "backlog/attestations/SL-018.json"',
    'tee backlog/approvals/SL-019.json < x.json',
    'python3 - <<\'EOF\'\nopen("backlog/evidence/SL-018.json","w").write("{}")\nEOF',
    'node -e "require(\'fs\').writeFileSync(\'backlog/attestations/SL-018.json\',\'{}\')"',
    'node -e "import(\'./scripts/work/cli.mjs\').then(m=>m.run([\'attest\',\'SL-018\',\'C6\']))"',
    'cp x.json backlog/approvals/SL-019.json',
  ];
  for (const c of denied) it(`denies: ${c.split('\n')[0]}`, () => expect(bash(c)).toBe('deny'));
});

describe('Bash: the owner-only workflow steps', () => {
  const denied = [
    'pnpm work approve SL-019',
    'pnpm -s work attest SL-018 C6 done',
    'pnpm run work approve SL-019',
    'node scripts/work/cli.mjs approve SL-019',
    'node scripts/work/cli.mjs attest SL-018 C6',
    'node -e "import(\'./scripts/work/cli.mjs\').then(m=>m.run([\'approve\',\'SL-019\']))"',
    'echo \'{"id":"SL-019"}\' > backlog/approvals/SL-019.json',
    'cp x.json backlog/attestations/SL-018.json',
    'python3 -c "open(\'backlog/evidence/SL-018.json\',\'w\').write(\'{}\')"',
    'sed -i s/false/true/ backlog/evidence/SL-018.json',
  ];
  for (const c of denied) it(`denies: ${c}`, () => expect(bash(c)).toBe('deny'));
});

describe('Bash: the safety boundaries from CLAUDE.md', () => {
  const denied = [
    'supabase link --project-ref abcdefghijklmnopqrst',
    'pnpm exec supabase link --project-ref abc',
    'supabase db push',
    'pnpm exec supabase db push --linked',
    'supabase migration repair --status applied 2026',
    'supabase db reset --linked',
    'supabase db reset',
    'supabase projects list',
    'supabase secrets set A=1',
    'supabase db dump --linked',
    'supabase db query --linked -f x.sql',
    'supabase db push --db-url postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
    'docker stop supabase_db_backend',
    'docker rm -f x',
    'docker system prune -af',
    'docker volume rm supabase_db_backend',
    'docker compose down',
    'docker network prune',
    'psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -c "select 1"',
    'cat ../superLeagueBackup/x.csv',
    'ls ~/superLeagueBackup',
    'cat backend/.env.local',
    'cat frontend/.env.staging.local',
    'grep KEY backend/supabase/.env',
    'printenv',
    'env',
    'curl -X POST https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/x',
    'curl -d "{}" https://abcdefghijklmnopqrst.supabase.co/auth/v1/signup',
  ];
  for (const c of denied) it(`denies: ${c}`, () => expect(bash(c)).toBe('deny'));
});

describe('Bash: protected configuration needs the owner\'s confirmation', () => {
  const asks = [
    'sed -i s/a/b/ .claude/settings.json',
    'echo x > .githooks/pre-push',
    'python3 -c "open(\'tests/gate-exemptions.json\',\'w\').write(\'{}\')"',
    'cp x scripts/work/claude-guard.mjs',
    'rm .githooks/pre-commit',
  ];
  for (const c of asks) it(`asks: ${c}`, () => expect(bash(c)).toBe('ask'));
});

describe('Bash: ordinary work stays allowed', () => {
  const allowed = [
    'git status --short',
    'git diff --stat',
    'git log --oneline -5',
    'git add scripts/work backend/tests/tooling/x.test.ts',
    'git commit -m "feat(core): add a thing" -m "Co-Authored-By: Claude <noreply@anthropic.com>"',
    'git commit -q -m "fix(core): handle n and -n in text"',
    'git push origin develop',
    'git push origin HEAD:develop',
    'git push',
    'git push origin ready/seed-refresh',
    'git push -u origin ready/seed-refresh',
    'git checkout -b ready/seed-refresh',
    'git restore --staged scripts/x.mjs',
    'git stash list',
    'pnpm test:all',
    'pnpm test',
    'pnpm work status',
    'pnpm -s work status SL-020',
    'pnpm work ready SL-020',
    'pnpm work done SL-018 --base abc123',
    'pnpm work check --base origin/develop',
    'node scripts/test-groups.mjs check',
    'node scripts/test-groups.mjs affected --strict --staged',
    'cd backend && pnpm exec vitest run tests/tooling',
    'cd backend && pnpm exec tsc --noEmit',
    'pnpm hooks:install',
    'gh run list --branch develop --limit 5',
    'gh run view 123 --log-failed',
    'gh api repos/{owner}/{repo}/rulesets --jq ".[].name"',
    'gh api repos/{owner}/{repo}/environments/Database%20Production',
    'gh variable list --env "Database Production"',
    'gh pr create --base develop --head ready/x --title "x"',
    'gh pr view 3',
    'supabase status',
    'pnpm exec supabase status',
    'supabase test db --local',
    'bash scripts/local-db.sh check',
    'pnpm db:start',
    'pnpm db:reset',
    'psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select 1"',
    'docker ps --format "{{.Names}}"',
    'docker logs supabase_db_backend',
    'cat backend/.env.example',
    'cat frontend/.env.example',
    'ls backend/supabase',
    'env FOO=1 node x.mjs',
    'curl -s https://abcdefghijklmnopqrst.supabase.co/auth/v1/settings',
    'node scripts/check-google-oauth.mjs http://127.0.0.1:54321',
    'sed -n 1,20p scripts/work/cli.mjs',
    'cat docs/release.md',
    'grep -rn "approve" scripts/work',
    'cat backlog/approvals/SL-019.json',
    'git add backlog/evidence/SL-018.json backlog/items/SL-018.md',
    'ssh -o BatchMode=yes -T git@github.com',
    'echo "push to main is blocked" ',
  ];
  for (const c of allowed) it(`allows: ${c}`, () => expect(bash(c)).toBe('allow'));
});

describe('Edit and Write', () => {
  it('denies writing the owner\'s approvals, attestations and machine evidence', () => {
    for (const f of ['/repo/backlog/approvals/SL-019.json', '/repo/backlog/attestations/SL-018.json', '/repo/backlog/evidence/SL-018.json', '/repo/.git/hooks/pre-push', '/repo/.git/config']) {
      expect(edit(f), f).toBe('deny');
    }
  });

  it('asks before changing the enforcement itself', () => {
    for (const f of [
      '/repo/.claude/settings.json',
      '/repo/.githooks/pre-commit',
      '/repo/scripts/work/claude-guard.mjs',
      '/repo/tests/gate-exemptions.json',
      '/repo/.github/workflows/ci.yml',
    ]) {
      expect(edit(f), f).toBe('ask');
    }
  });

  it('allows ordinary files, including backlog items, plans and walkthroughs', () => {
    for (const f of [
      '/repo/backend/app/api/players/route.ts',
      '/repo/frontend/src/pages/Home.jsx',
      '/repo/backlog/items/SL-020.md',
      '/repo/docs/plans/SL-020.md',
      '/repo/docs/walkthroughs/SL-018.md',
      '/repo/backend/tests/tooling/x.test.ts',
      '/repo/docs/release.md',
      '/repo/scripts/work/cli.mjs',
      '/repo/scripts/hooks/lib.mjs',
      '/repo/scripts/test-groups.mjs',
      '/repo/tests/groups.json',
      '/repo/CLAUDE.md',
    ]) {
      expect(edit(f), f).toBe('allow');
    }
  });

  it('treats a relative path the same as an absolute one', () => {
    expect(decideEdit('backlog/approvals/SL-019.json', { root: '/repo' }).decision).toBe('deny');
    expect(decideEdit('/repo/../repo/backlog/approvals/SL-019.json', { root: '/repo' }).decision).toBe('deny');
  });
});

describe('the hook process', () => {
  const guard = join(root, 'scripts/work/claude-guard.mjs');
  const send = (event: object) => spawnSync('node', [guard, 'pre-tool'], { input: JSON.stringify(event), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });

  it('blocks a denied command with exit code 2 and a plain-language reason on stderr', () => {
    const r = send({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m x' } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no-verify|bypass/i);
  });

  it('answers ask with the permission decision JSON and exit code 0', () => {
    const r = send({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(root, '.claude/settings.json') } });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'ask' });
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/enforcement|owner/i);
  });

  it('says nothing and exits 0 for allowed calls and for tools it does not judge', () => {
    for (const e of [
      { tool_name: 'Bash', tool_input: { command: 'git status' } },
      { tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } },
    ]) {
      const r = send({ hook_event_name: 'PreToolUse', ...e });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    }
  });

  it('fails closed: malformed input is blocked, never waved through', () => {
    const r = spawnSync('node', [guard, 'pre-tool'], { input: 'not json', encoding: 'utf8' });
    expect(r.status).toBe(2);
  });

  it('SessionStart reports facts about the workflow as additional context', () => {
    const r = spawnSync('node', [guard, 'session-start'], { input: JSON.stringify({ hook_event_name: 'SessionStart' }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    expect(r.status).toBe(0);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput;
    expect(ctx.hookEventName).toBe('SessionStart');
    expect(ctx.additionalContext).toMatch(/pnpm work/);
  });
});

describe('.claude/settings.json (tracked)', () => {
  const file = join(root, '.claude/settings.json');
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

  it('keeps the model and plugin choices', () => {
    expect(settings.model).toBe('opusplan');
    expect(settings.enabledPlugins?.['superpowers@claude-plugins-official']).toBe(true);
  });

  it('runs the guard before every Bash, Edit and Write call', () => {
    const pre = settings.hooks?.PreToolUse ?? [];
    const matchers = pre.map((h: { matcher: string }) => h.matcher).join('|');
    for (const tool of ['Bash', 'Edit', 'Write']) expect(matchers, tool).toContain(tool);
    for (const h of pre) {
      const cmd = h.hooks[0].command as string;
      expect(cmd).toMatch(/claude-guard\.mjs pre-tool/);
      expect(cmd).toContain('CLAUDE_PROJECT_DIR');
    }
    expect(existsSync(join(root, 'scripts/work/claude-guard.mjs'))).toBe(true);
  });

  it('reports workflow state at the start of a session', () => {
    expect(JSON.stringify(settings.hooks?.SessionStart)).toMatch(/claude-guard\.mjs session-start/);
  });

  it('also denies the clearest bypasses through permission rules the harness enforces itself', () => {
    const deny = (settings.permissions?.deny ?? []).join('\n');
    for (const needle of ['git push --force', 'work approve', 'work attest', '--no-verify', 'supabase link', '--linked']) {
      expect(deny, needle).toContain(needle);
    }
  });
});
