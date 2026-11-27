import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { scopeQuery, useLeague } from '../context/LeagueContext';
import { API_BASE_URL } from '../lib/api';

// The message a person reads when a load fails. The server's own message is used only for client errors (4xx).
export function apiErrorMessage(status, body) {
  if (status === 0) return navigator.onLine === false
    ? 'You appear to be offline. Check your connection and try again.'
    : 'Could not reach the server. Try again.';
  if (status >= 500) return 'The server could not answer. Try again in a moment.';
  return body?.error || `This could not be loaded (${status}).`;
}

/**
 * A React Hook for standard GET requests to the backend API.
 * Automatically injects the Supabase JWT Authorization header.
 *
 * Returns { data, error, loading, retry }. error is null or { status, message }; status is 0 for a network failure.
 * On error, data is null. retry repeats the request. refetch is the same function, kept for existing callers.
 *
 * @param {string} endpoint The API route (e.g., "/matches")
 */
export function useApi(endpoint) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const { seasonScope } = useLeague();
  // Only the newest request may write state, so a slow earlier response cannot overwrite a later one.
  const requestId = useRef(0);
  // An endpoint that names its own division (admin tools) is sent as written. Otherwise the request is scoped to
  // the selected division and season, once the division's seasons are known (so it is not sent twice).
  const explicit = Boolean(endpoint && /[?&]division=/.test(endpoint));
  const scope = explicit ? '' : (seasonScope.ready ? scopeQuery(seasonScope) : null);

  const fetchData = useCallback(async () => {
    if (!endpoint || scope === null) return;
    const id = ++requestId.current;

    try {
      setLoading(true);
      setError(null);
      const { data: { session } } = await supabase.auth.getSession();

      const headers = session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {};

      const separator = endpoint.includes('?') ? '&' : '?';
      const url = scope ? `${API_BASE_URL}${endpoint}${separator}${scope}` : `${API_BASE_URL}${endpoint}`;

      const response = await fetch(url, { headers });
      const body = await response.json().catch(() => null);
      if (id !== requestId.current) return;
      if (!response.ok) {
        setData(null);
        setError({ status: response.status, message: apiErrorMessage(response.status, body) });
        return;
      }
      setData(body);
    } catch {
      if (id !== requestId.current) return;
      setData(null);
      setError({ status: 0, message: apiErrorMessage(0) });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [endpoint, scope]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, error, loading, retry: fetchData, refetch: fetchData };
}
/**
 * A utility function for mutations (POST, PUT, DELETE) to the backend API.
 * Automatically injects the Supabase JWT Authorization header.
 * 
 * @param {string} endpoint The API route (e.g., "/polls/vote")
 * @param {object} options Fetch options object (method, body, etc.)
 */
export const fetchApi = async (endpoint, options = {}) => {
  const { data: { session } } = await supabase.auth.getSession();
  
  const headers = { 
    'Content-Type': 'application/json',
    ...options.headers 
  };
  
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });
  
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    const error = new Error(failure?.message || `API Request Failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  
  return response.json();
};
