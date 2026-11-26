import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// The divisions the viewer may see, in their configured order (row level security hides hidden or archived
// divisions from everyone but dictators). Divisions are data, so tools list them instead of hard-coding them.
export function useDivisions({ publicOnly = false } = {}) {
  const [state, setState] = useState({ divisions: [], loading: true, error: '' });
  useEffect(() => {
    let cancelled = false;
    let query = supabase.from('divisions').select('id, slug, name, short_name, primary_color, logo_url, archived_at');
    if (publicOnly) query = query.eq('visibility', 'public').is('archived_at', null);
    query.order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(({ data, error }) => {
        if (!cancelled) setState({ divisions: (data || []).filter((d) => !d.archived_at), loading: false, error: error?.message || '' });
      });
    return () => { cancelled = true; };
  }, [publicOnly]);
  return state;
}
