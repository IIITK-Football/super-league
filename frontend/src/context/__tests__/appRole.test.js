// Group: frontend-components. The role the app acts on: only the agreed roles count; anything else (such as the retired
// legacy admin value) is an ordinary user, never a dictator.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const { appRole } = await import('../AuthContext');

describe('appRole', () => {
  it('treats any unknown role, such as the retired admin value, as an ordinary user', () => {
    for (const role of ['admin', 'scorer?', 'Dictator', '']) expect(appRole(role)).toBe('default');
  });
  it('keeps the agreed roles and defaults a missing role to an ordinary user', () => {
    for (const role of ['default', 'captain', 'editor', 'dictator']) expect(appRole(role)).toBe(role);
    expect(appRole(undefined)).toBe('default');
    expect(appRole(null)).toBe('default');
  });
});
