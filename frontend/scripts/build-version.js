// The release identity of a frontend build, served as /version.json next to the site (SL-031). Together with the
// Worker's /api/health (commit and version) it names the Pages and Worker pair a browser is using, which is what a
// rollback restores. Cloudflare Pages provides the commit at build time; a local build reads it from git.
import { execFileSync } from 'node:child_process'

const COMMIT = /^[0-9a-f]{7,40}$/

export function buildVersion(env = process.env, git = gitCommit) {
  const fromPages = env.CF_PAGES_COMMIT_SHA ?? ''
  const commit = COMMIT.test(fromPages) ? fromPages : git()
  return {
    commit: COMMIT.test(commit ?? '') ? commit : null,
    branch: env.CF_PAGES_BRANCH || null,
    builtAt: new Date().toISOString(),
  }
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

// Vite plugin: emits version.json into the build output.
export function versionFile() {
  return {
    name: 'sl-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(buildVersion())}\n` })
    },
  }
}
