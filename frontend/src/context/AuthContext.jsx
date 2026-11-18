import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createAuthApi } from '../lib/authApi';
import { COLLEGE_EMAIL_MESSAGE, isCollegeEmail } from '../lib/authRules';

// The role the app acts on for a stored role: only the agreed roles count; anything else is an ordinary user.
const KNOWN_ROLES = ['default', 'captain', 'editor', 'dictator'];
export function appRole(stored) {
  return KNOWN_ROLES.includes(stored) ? stored : 'default';
}

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const authApi = useMemo(() => createAuthApi(supabase, { origin: window.location.origin }), []);

  // Helper to fetch user's public profile strictly
  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error("Error fetching profile:", error);
        return null;
      }
      return data;
    } catch (err) {
      console.error(err);
      return null;
    }
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

  const handleSession = async (session) => {
    if (!session?.user) {
      setUser(null);
      setProfile(null);
      setRole(null);
      setLoading(false);
      return;
    }

    const { user } = session;

    // Domain Lock Check
    if (!isCollegeEmail(user.email)) {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      setRole(null);
      setLoading(false);
      alert(`Access Denied: ${COLLEGE_EMAIL_MESSAGE}`);
      return;
    }

    // Valid college email allowed, fetch their onboarded profile
    setUser(user);
    const userProfile = await fetchProfile(user.id);
    setProfile(userProfile);
    const { data: roleRecord } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    setRole(appRole(roleRecord?.role));
    setLoading(false);
  };

  const signOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setRole(null);
    setLoading(false);
  };

  return (
    <AuthContext.Provider value={{ user, profile, role, loading, ...authApi, signOut, setProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
