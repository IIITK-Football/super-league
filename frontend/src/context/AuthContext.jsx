import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createAuthApi } from '../lib/authApi';
import { COLLEGE_EMAIL_MESSAGE, isCollegeEmail } from '../lib/authRules';

// Roles are independent grants: captain, scorer, editor and dictator. A normal user holds none and no role implies
// another. Only the agreed roles count; anything else in the list is ignored.
const KNOWN_ROLES = ['captain', 'scorer', 'editor', 'dictator'];
export function appRoles(stored) {
  return Array.isArray(stored) ? KNOWN_ROLES.filter((r) => stored.includes(r)) : [];
}

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  // A failed load is kept as an error, never read as "no profile" or "no roles".
  const [profileError, setProfileError] = useState(null);
  // null while loading; an array (possibly empty: a normal user) once known.
  const [roles, setRoles] = useState(null);
  const [rolesError, setRolesError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Shown inline on the sign-in page when the account is not a college account.
  const [accessError, setAccessError] = useState(null);
  const authApi = useMemo(() => createAuthApi(supabase, { origin: window.location.origin }), []);

  const fetchProfile = async (userId) => {
    // Explicit columns: the email column is not readable through the Data API (the session has the user's email).
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, real_name, nickname, team_flair_id, wc_team_flair, created_at')
      .eq('id', userId)
      .maybeSingle();
    return error ? { error } : { data };
  };

  const handleSession = async (session) => {
    setAccessError(null);
    if (!session?.user) {
      setUser(null);
      setProfile(null);
      setProfileError(null);
      setRoles(null);
      setRolesError(null);
      setLoading(false);
      return;
    }

    const { user } = session;

    // Domain Lock Check
    if (!isCollegeEmail(user.email)) {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      setRoles(null);
      setLoading(false);
      setAccessError(COLLEGE_EMAIL_MESSAGE);
      return;
    }

    // Valid college email allowed, fetch their onboarded profile and roles
    setUser(user);
    const profileResult = await fetchProfile(user.id).catch((error) => ({ error }));
    setProfile(profileResult.data ?? null);
    setProfileError(profileResult.error ?? null);
    const { data: held, error: rolesLoadError } = await Promise.resolve(supabase.rpc('my_roles')).catch((error) => ({ error })); // the query builder is thenable only
    setRoles(rolesLoadError ? null : appRoles(held));
    setRolesError(rolesLoadError ?? null);
    setLoading(false);
  };

  useEffect(() => {
    // Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
    });

    // Listen for auth changes (login, logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load the session again after a failed profile or role load.
  const retryAuth = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    await handleSession(session);
  };

  const signOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setProfileError(null);
    setRoles(null);
    setRolesError(null);
    setLoading(false);
  };

  return (
    <AuthContext.Provider value={{
      user, profile, profileError, roles, rolesError, accessError, retryAuth,
      hasRole: (r) => Boolean(roles?.includes(r)), loading, ...authApi, signOut, setProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
