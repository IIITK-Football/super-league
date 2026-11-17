// Group: tooling. .github/workflows/og-screenshots.yml takes screenshots of the production site and syncs them to R2.
// These checks keep it runnable (a runner Playwright supports) and keep the R2 upload safe (never a partial set).
import { readFileSync } from 'node:fs';
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
  it('runs on a pinned Ubuntu release that Playwright supports, not the moving ubuntu-latest', () => {
    expect(text).toMatch(/runs-on: ubuntu-24\.04\b/);
    expect(text).not.toMatch(/ubuntu-latest/);
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

  it('does not capture /clubs (it is not a real route: the site redirects it to the home page)', () => {
    expect(script).not.toMatch(/'clubs'/);
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
