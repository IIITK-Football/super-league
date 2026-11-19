import { useCallback, useEffect, useRef, useState } from 'react';

// Runs search(query) once the person stops typing and applies only the newest answer, so a slow reply to an earlier
// query never replaces a newer one. status: 'idle' (query too short), 'loading', 'ready' or 'error'.
// search returns { data, error } like the Supabase client; deps lists what else search depends on.
export function useLatestSearch(search, query, { delay = 250, minLength = 0, deps = [] } = {}) {
  const [state, setState] = useState({ status: 'idle', results: [], error: '' });
  const latest = useRef(0);
  const term = query.trim();

  const run = useCallback(async (text) => {
    const request = ++latest.current;
    if (text.length < minLength) { setState({ status: 'idle', results: [], error: '' }); return; }
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const { data, error } = await search(text);
      if (request !== latest.current) return;
      setState(error ? { status: 'error', results: [], error: error.message || 'The search failed.' } : { status: 'ready', results: data || [], error: '' });
    } catch (e) {
      if (request === latest.current) setState({ status: 'error', results: [], error: e?.message || 'The search failed.' });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (term.length >= minLength) setState((s) => ({ ...s, status: 'loading', error: '' }));
    const timer = setTimeout(() => run(term), delay);
    return () => clearTimeout(timer);
  }, [term, run, delay, minLength]);

  return { ...state, retry: () => run(term), refresh: () => run(term) };
}
