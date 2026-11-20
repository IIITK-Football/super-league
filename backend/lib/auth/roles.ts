// Role helpers. Roles are independent grants (captain, scorer, editor, dictator); a normal user holds none. They are
// read through my_roles(), which returns only the caller's own grants, so a route never reads the user_roles table
// and never assumes a person has one role. Scoped powers (a captain's team entry, a scorer's matches) are checked
// by the database helpers is_captain_of() and can_score(), and row level security says the same.
import type { SupabaseClient } from '@supabase/supabase-js';

export type Role = 'captain' | 'scorer' | 'editor' | 'dictator';

export async function myRoles(supabase: SupabaseClient): Promise<Role[]> {
  const { data, error } = await supabase.rpc('my_roles');
  if (error) throw error;
  return (data ?? []) as Role[];
}

export const hasAnyRole = (roles: readonly string[], allowed: readonly Role[]) => roles.some((r) => (allowed as readonly string[]).includes(r));
