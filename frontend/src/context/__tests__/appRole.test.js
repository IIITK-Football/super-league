// Group: frontend-components. The role the app acts on: the legacy stored role admin grants nothing (an ordinary
// user), and the agreed roles pass through unchanged.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const { appRole } = await import('../AuthContext');

describe('appRole', () => {
  it('treats the legacy admin role as an ordinary user, never as a dictator', () => {
    expect(appRole('admin')).toBe('default');
  });
  it('keeps the agreed roles and defaults a missing role to an ordinary user', () => {
    for (const role of ['default', 'captain', 'editor', 'dictator']) expect(appRole(role)).toBe(role);
    expect(appRole(undefined)).toBe('default');
    expect(appRole(null)).toBe('default');
  });
});
