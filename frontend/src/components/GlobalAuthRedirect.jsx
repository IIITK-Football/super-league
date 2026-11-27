import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Pages that must never be left automatically after sign-in: the sign-in pages handle their own
// redirect, and the reset page must stay until the new password is saved.
const STAY_PUT = new Set(['/login', '/hq-login', '/reset-password']);

export function GlobalAuthRedirect() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Whenever a user logs in, check if they had a saved destination!
    if (user && !STAY_PUT.has(location.pathname)) {
      const redirectUrl = sessionStorage.getItem('authRedirect');
      if (redirectUrl) {
        sessionStorage.removeItem('authRedirect'); // Clean up
        navigate(redirectUrl, { replace: true }); // Send them there!
      }
    }
  }, [user, navigate, location.pathname]);

  return null; // This component renders nothing visually
}
