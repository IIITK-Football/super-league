import { Navigate } from 'react-router-dom';

// Old addresses that now live elsewhere. /admin was the dashboard's address before roles were settled; the dashboard
// is /dictator, and admin is not a role.
export const LEGACY_REDIRECTS = [
  { from: '/admin', to: '/dictator' },
];

export function LegacyRedirect({ to }) { // eslint-disable-line react/prop-types
  return <Navigate to={to} replace />;
}
