// The build writes /version.json with the commit it was built from: Cloudflare Pages' commit when present, otherwise
// the local git commit, and never anything that is not a commit id.
import { describe, expect, it } from 'vitest'
import { buildVersion } from '../../../scripts/build-version.js'

describe('build version', () => {
  it('uses the Pages commit and branch when Pages builds the site', () => {
    const v = buildVersion({ CF_PAGES_COMMIT_SHA: 'abcdef1234567', CF_PAGES_BRANCH: 'develop' }, () => 'ffffffff')
    expect(v).toMatchObject({ commit: 'abcdef1234567', branch: 'develop' })
    expect(Date.parse(v.builtAt)).not.toBeNaN()
  })

  it('falls back to git locally, and records nothing that is not a commit id', () => {
    expect(buildVersion({}, () => '1234567890abcdef').commit).toBe('1234567890abcdef')
    expect(buildVersion({ CF_PAGES_COMMIT_SHA: 'not a sha' }, () => null).commit).toBeNull()
    expect(buildVersion({}, () => 'rm -rf /').commit).toBeNull()
  })
})
