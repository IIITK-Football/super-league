import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useLeague } from '../context/LeagueContext';
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
  const { division } = useLeague(); // <--- Get the current division

  const fetchData = useCallback(async () => {
    if (!endpoint) return;
    
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      
      const headers = session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {};
      
      // Append the division to the API URL!
      const separator = endpoint.includes('?') ? '&' : '?';
      const urlWithDivision = `${API_BASE_URL}${endpoint}${separator}division=${division}`;
      
      const response = await fetch(urlWithDivision, { headers });
      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error("API Error:", err);
    } finally {
      setLoading(false);
    }
  }, [endpoint, division]); // <--- Add division to the dependency array!

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
