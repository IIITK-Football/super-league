import { Navigate } from 'react-router-dom';
import { AdminDashboard } from './AdminDashboard';
import { TeamBuilder } from './TeamBuilder';
import ManageNews from '../components/admin/ManageNews';
import { useAuth } from '../context/AuthContext';

// Which grants may open each workspace. Roles are independent and none implies another: a scorer reaches the dashboard
// (which shows them only Live Matches), a captain the team builder, an editor the newsletter. A dictator manages
// everything, so the dictator grant opens each of them. The server and the database check the same rules.
const OPENS = {
    dictator: ['dictator', 'scorer'],
    captain: ['captain', 'dictator'],
    editor: ['editor', 'dictator'],
};

export function RoleWorkspace({ requiredRole }) {
    const { user, roles, loading } = useAuth();

    if (loading) return <div className="min-h-screen bg-black" />;
    if (!user) return <Navigate to="/login" replace />;
    if (!roles) return <div className="min-h-screen bg-black" />;
    if (!(OPENS[requiredRole] ?? []).some((r) => roles.includes(r))) return <Navigate to="/" replace />;

    if (requiredRole === 'dictator') return <AdminDashboard />;
    if (requiredRole === 'editor') return <div className="min-h-screen bg-black pt-20 text-white"><ManageNews /></div>;
    return <TeamBuilder />;
}
