import { createClient } from '@supabase/supabase-js';
import { readPublicEnv } from './env';

// Fails with the names of missing/unsafe variables instead of using dummy fallbacks.
const { supabaseUrl, supabasePublishableKey } = readPublicEnv();

// Browser client: publishable key only (RLS applies). Never put an elevated key in the frontend.
export const supabase = createClient(supabaseUrl, supabasePublishableKey);
