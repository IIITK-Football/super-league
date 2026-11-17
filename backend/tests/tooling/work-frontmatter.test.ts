// Group: tooling. scripts/work/frontmatter.mjs reads and writes the small YAML subset used by backlog item files
// (no dependency). It must round-trip exactly, because the work commands rewrite status fields in place.
import { describe, expect, it } from 'vitest';
// @ts-ignore plain ESM
import { parseItem as parse, serializeItem } from '../../../scripts/work/frontmatter.mjs';

const parseItem = parse as (text: string) => { meta: any; body: string };

const sample = `---
id: SL-018
title: "Close the captain_update_team_member exposure"
phase: 1
status: in-progress
legacy: true
dependsOn: []
decisions: [D-01, D-02]
groups: [database, auth-identity]
plan: docs/plans/SL-018.md
checks:
  - id: C1
    text: "Anonymous callers cannot execute the function"
    verify: test:backend/supabase/tests/database/003_captain_update_team_member.test.sql
  - id: C2
    text: "Owner applies the migration to production"
    verify: manual:owner
---
**Issue:** body text stays exactly as written.

- bullet
`;

describe('parseItem', () => {
  it('reads scalars, lists and the checks block', () => {
    const { meta, body } = parseItem(sample);
    expect(meta.id).toBe('SL-018');
    expect(meta.title).toBe('Close the captain_update_team_member exposure');
    expect(meta.phase).toBe(1);
    expect(meta.legacy).toBe(true);
    expect(meta.dependsOn).toEqual([]);
    expect(meta.decisions).toEqual(['D-01', 'D-02']);
    expect(meta.groups).toEqual(['database', 'auth-identity']);
    expect(meta.checks).toEqual([
      { id: 'C1', text: 'Anonymous callers cannot execute the function', verify: 'test:backend/supabase/tests/database/003_captain_update_team_member.test.sql' },
      { id: 'C2', text: 'Owner applies the migration to production', verify: 'manual:owner' },
    ]);
    expect(body).toBe('**Issue:** body text stays exactly as written.\n\n- bullet\n');
  });

  it('round-trips byte for byte', () => {
    const { meta, body } = parseItem(sample);
    expect(serializeItem({ meta, body })).toBe(sample);
  });

  it('keeps colons, quotes and dashes in titles safe', () => {
    const meta = { id: 'SL-001', title: 'Plan: "quoted" — dash', phase: 0, status: 'not-started', dependsOn: [], decisions: [], groups: [], checks: [] };
    const again = parseItem(serializeItem({ meta, body: 'x\n' })).meta;
    expect(again.title).toBe(meta.title);
  });

  it('changing one field changes nothing else', () => {
    const { meta, body } = parseItem(sample);
    meta.status = 'done';
    const out = serializeItem({ meta, body });
    expect(out.replace('status: done', 'status: in-progress')).toBe(sample);
  });

  it('rejects a file without front matter, an unterminated block, and unsupported syntax', () => {
    expect(() => parseItem('no front matter\n')).toThrow(/front matter/i);
    expect(() => parseItem('---\nid: SL-001\n')).toThrow(/unterminated/i);
    expect(() => parseItem('---\nid: SL-001\nnested:\n  deep:\n    deeper: 1\n---\n')).toThrow(/unsupported/i);
  });

  it('rejects a repeated key', () => {
    expect(() => parseItem('---\nid: SL-001\nid: SL-002\n---\n')).toThrow(/duplicate/i);
  });
});
