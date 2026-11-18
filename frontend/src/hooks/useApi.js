import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { scopeQuery, useLeague } from '../context/LeagueContext';
import { API_BASE_URL } from '../lib/api';
/**
 * A React Hook for standard GET requests to the backend API.
 * Automatically injects the Supabase JWT Authorization header.
 * 
 * @param {string} endpoint The API route (e.g., "/matches")
 * @returns {object} { data, error, loading, refetch }
 */
export function useApi(endpoint) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { seasonScope } = useLeague();
  // An endpoint that names its own division (admin tools) is sent as written. Otherwise the request is scoped to
  // the selected division and season, once the division's seasons are known (so it is not sent twice).
  const explicit = Boolean(endpoint && /[?&]division=/.test(endpoint));
  const scope = explicit ? '' : (seasonScope.ready ? scopeQuery(seasonScope) : null);

  const fetchData = useCallback(async () => {
    if (!endpoint || scope === null) return;
    
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      
      const headers = session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {};
      
      const separator = endpoint.includes('?') ? '&' : '?';
      const url = scope ? `${API_BASE_URL}${endpoint}${separator}${scope}` : `${API_BASE_URL}${endpoint}`;
      
      const response = await fetch(url, { headers });
      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error("API Error:", err);
    } finally {
      setLoading(false);
    }
  }, [endpoint, scope]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, refetch: fetchData };
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
    throw new Error(`API Request Failed: ${response.status}`);
  }
  
  return response.json();
};
