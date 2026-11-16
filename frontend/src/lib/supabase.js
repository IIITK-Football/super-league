import { createClient } from '@supabase/supabase-js';
import { readPublicEnv } from './env';

// Fails with the names of missing/unsafe variables instead of using dummy fallbacks.
const { supabaseUrl, supabaseAnonKey } = readPublicEnv();

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
