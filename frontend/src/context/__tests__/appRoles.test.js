// Group: frontend-components. The roles the app acts on: independent grants, so a person can hold several; only the
// agreed roles count, and anything else (the retired admin value, a misspelling, a missing list) grants nothing.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const { appRoles } = await import('../AuthContext');

describe('appRoles', () => {
  it('ignores any unknown role, such as the retired admin value, and reads a missing list as a normal user', () => {
    expect(appRoles(['admin', 'Dictator', ''])).toEqual([]);
    expect(appRoles(null)).toEqual([]);
    expect(appRoles(undefined)).toEqual([]);
    expect(appRoles('dictator')).toEqual([]);
  });
  it('keeps the agreed roles, several at once, in a stable order, and drops duplicates', () => {
    expect(appRoles(['editor', 'captain', 'editor'])).toEqual(['captain', 'editor']);
    expect(appRoles(['dictator', 'scorer', 'captain', 'editor'])).toEqual(['captain', 'scorer', 'editor', 'dictator']);
  });
  it('a normal user holds none: there is no default role', () => {
    expect(appRoles([])).toEqual([]);
  });
});
