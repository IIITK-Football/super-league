import { Link, Navigate } from 'react-router-dom';
import { AdminDashboard } from './AdminDashboard';
import { TeamBuilder } from './TeamBuilder';
import ManageNews from '../components/admin/ManageNews';
import { useAuth } from '../context/AuthContext';
import { ErrorState, Skeleton } from '../components/ui';

// Which grants may open each workspace. Roles are independent and none implies another: a scorer reaches the dashboard
// (which shows them only Live Matches), a captain the team builder, an editor the newsletter. A dictator manages
// everything, so the dictator grant opens each of them. The server and the database check the same rules.
const OPENS = {
    dictator: ['dictator', 'scorer'],
    captain: ['captain', 'dictator'],
    editor: ['editor', 'dictator'],
};

export function RoleWorkspace({ requiredRole }) {
    const { user, roles, rolesError, retryAuth, loading } = useAuth();

    if (loading || (user && !roles && !rolesError)) return <Skeleton className="h-64 w-full" />;
    if (!user) return <Navigate to="/login" replace />;
    if (rolesError) return <ErrorState title="Could not load your access" message="Check your connection, then try again." onRetry={retryAuth} />;
    if (!(OPENS[requiredRole] ?? []).some((r) => roles.includes(r))) {
        return (
            <div className="space-y-4 py-12">
                <p className="font-display text-3xl font-bold text-ink">You do not have access to this workspace</p>
                <Link to="/" className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4">Go to the home page</Link>
            </div>
        );
    }

    if (requiredRole === 'dictator') return <AdminDashboard />;
    if (requiredRole === 'editor') return <ManageNews />;
    return <TeamBuilder />;
}
