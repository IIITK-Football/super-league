// Group: tooling. .github/workflows/og-screenshots.yml takes screenshots of the production site and syncs them to R2.
// These checks keep it runnable (a runner Playwright supports) and keep the R2 upload safe (never a partial set).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const text = readFileSync(join(root, '.github/workflows/og-screenshots.yml'), 'utf8');
const script = readFileSync(join(root, 'frontend/scripts/take-screenshots.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'frontend/package.json'), 'utf8'));

const step = (name: string) => {
  const start = text.lastIndexOf('- name:', text.indexOf(name));
  const next = text.indexOf('\n      - name:', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
};

describe('og-screenshots workflow', () => {
  it('runs on ubuntu-latest, with a Playwright that supports the Ubuntu release that tag currently means (26.04)', () => {
    expect(text).toMatch(/runs-on: ubuntu-latest\b/);
    expect(text).not.toMatch(/ubuntu-2\d\.04/);
    // The installed Playwright must know Ubuntu 26.04, otherwise the install step fails exactly as it did before.
    const store = join(root, 'frontend/node_modules/.pnpm');
    const dirs = existsSync(store) ? readdirSync(store).filter((d) => d.startsWith('playwright-core@')) : [];
    const declared = String(pkg.devDependencies?.playwright ?? pkg.dependencies?.playwright).replace(/^[^\d]*/, '');
    const installed = dirs.find((d) => d.startsWith(`playwright-core@${declared.split('.').slice(0, 2).join('.')}`));
    expect(installed, `playwright-core for ${declared} is installed`).toBeTruthy();
    const bundle = readFileSync(join(store, installed!, 'node_modules/playwright-core/lib/coreBundle.js'), 'utf8');
    expect(bundle).toContain('ubuntu26.04');
  });

  it('never lets two runs upload at once, and does not cancel one that is uploading', () => {
    expect(text).toMatch(/concurrency:\s*\n\s+group: og-screenshots\s*\n\s+cancel-in-progress: false/);
  });

  it('refreshes on a push to main, nightly and on demand, not on every develop push (it screenshots the production site)', () => {
    const on = text.slice(text.indexOf('on:'), text.indexOf('jobs:'));
    expect(on).toMatch(/push:\s*\n\s+branches: \[main\]/);
    expect(on).not.toMatch(/develop/);
    expect(on).toMatch(/schedule:/);
    expect(on).toMatch(/workflow_dispatch:/);
  });

  it('uploads to production R2 only from main: a manual dispatch from another branch runs nothing', () => {
    const job = text.slice(text.indexOf('snapshot-and-sync:'));
    expect(job).toMatch(/^\s+if: github\.ref == 'refs\/heads\/main'\s*$/m);
    expect(job.indexOf("if: github.ref == 'refs/heads/main'")).toBeLessThan(job.indexOf('steps:'));
  });

  it('captures the home page deterministically: the Super League slide, with the carousel paused', () => {
    expect(script).toMatch(/Show Super League/);
    expect(script).toMatch(/Pause carousel video/);
  });

  it('installs Chromium with its system dependencies before taking screenshots', () => {
    const install = text.indexOf('playwright install --with-deps chromium');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(text.indexOf('take-screenshots.js'));
  });

  it('declares a current Playwright (1.65 or newer)', () => {
    const [major, minor] = String(pkg.dependencies?.playwright ?? pkg.devDependencies?.playwright).replace(/^[^\d]*/, '').split('.').map(Number);
    expect(major).toBe(1);
    expect(minor).toBeGreaterThanOrEqual(65);
  });

  it('checks that every route was captured before anything is uploaded', () => {
    const check = text.indexOf('Check every screenshot was captured');
    expect(check).toBeGreaterThan(text.indexOf('take-screenshots.js'));
    expect(check).toBeLessThan(text.indexOf('aws s3 sync'));
    // the check lists every route the script captures ("" is home)
    const routes = [...script.match(/const routes = \[([^\]]*)\]/)![1].matchAll(/'([^']*)'/g)].map((m) => m[1] || 'home');
    for (const r of routes) expect(step('Check every screenshot was captured'), r).toMatch(new RegExp(`\\b${r}\\b`));
    // ...and lists exactly those routes, so a page the script no longer captures cannot fail the job
    const listed = step('Check every screenshot was captured').match(/for name in ([^;]*); do/)![1].trim().split(/\s+/);
    expect(listed.sort()).toEqual([...routes].sort());
  });

  it('only captures routes that exist in the app: a route the router does not know redirects to the home page and would overwrite R2 with a copy of it', () => {
    const app = readFileSync(join(root, 'frontend/src/App.jsx'), 'utf8');
    const known = new Set([...app.matchAll(/path="\/([^"]*)"/g)].map((m) => m[1].replace(/\/:.*$/, '')));
    const routes = [...script.match(/const routes = \[([^\]]*)\]/)![1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    for (const r of routes) expect(known.has(r), `/${r} is a route in App.jsx`).toBe(true);
    for (const gone of ['clubs', 'statistics', 'legends']) expect(routes).not.toContain(gone);
  });

  it('waits for a normal page load, not network idle (the home page keeps streaming a video, so network idle times out)', () => {
    expect(script).not.toMatch(/networkidle/);
    expect(script).toMatch(/waitUntil: 'load'/);
  });

  it('only adds or overwrites images in R2: it never deletes (no --delete)', () => {
    expect(text).toMatch(/aws s3 sync/);
    expect(text).not.toMatch(/--delete/);
  });

  it('uploads with the R2 secrets and no secret value in the file', () => {
    expect(step('☁️ Upload to R2')).toMatch(/secrets\.R2_BUCKET_NAME/);
    expect(text).not.toMatch(/[A-Za-z0-9]{32,}/);
  });
});
