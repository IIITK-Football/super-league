import { Link, Navigate, useParams } from 'react-router-dom';
import { AdminDashboard } from './AdminDashboard';
import { useAuth } from '../context/AuthContext';
import { ErrorState, Skeleton } from '../components/ui';
import { allows, toolById } from './workspace/tools';

// Which grants may open each workspace address. Roles are independent and none implies another: /dictator opens for a
// dictator (the overview) or a scorer (sent to Live matches), /dictator/<tool> for the grants that own that tool,
// /team-builder for a captain and /editor for an editor. A dictator manages everything, so the dictator grant opens
// each of them. The server and the database check the same rules.
const ENTRY = { captain: 'team', editor: 'news' };
const DASHBOARD = ['dictator', 'scorer'];

export function RoleWorkspace({ requiredRole }) { // eslint-disable-line react/prop-types
  const { user, roles, rolesError, retryAuth, loading } = useAuth();
  const { tool: param } = useParams();
  const toolId = ENTRY[requiredRole] ?? param;
  const tool = toolId ? toolById(toolId) : null;

  if (loading || (user && !roles && !rolesError)) return <Skeleton className="h-64 w-full" />;
  if (!user) return <Navigate to="/login" replace />;
  if (rolesError) return <ErrorState title="Could not load your access" message="Check your connection, then try again." onRetry={retryAuth} />;
  if (toolId && !tool) return <Navigate to="/dictator" replace />;
  if (tool ? !allows(tool, roles) : !DASHBOARD.some((r) => roles.includes(r))) {
    return (
      <div className="space-y-4 py-12">
        <p className="font-display text-3xl font-bold text-ink">You do not have access to this workspace</p>
        <Link to="/" className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4">Go to the home page</Link>
      </div>
    );
  }
  // A scorer has no overview: their one tool is Live matches.
  if (!tool && !roles.includes('dictator')) return <Navigate to="/dictator/live" replace />;
  return <AdminDashboard toolId={tool?.id ?? 'overview'} />;
}
