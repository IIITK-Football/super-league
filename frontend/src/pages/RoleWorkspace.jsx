import { Navigate } from 'react-router-dom';
import { AdminDashboard } from './AdminDashboard';
import { TeamBuilder } from './TeamBuilder';
import ManageNews from '../components/admin/ManageNews';
import { useAuth } from '../context/AuthContext';

export function RoleWorkspace({ requiredRole }) {
    const { user, role, loading } = useAuth();

    if (loading) return <div className="min-h-screen bg-black" />;
    if (!user) return <Navigate to="/login" replace />;
    if (!role) return <div className="min-h-screen bg-black" />;
    if (requiredRole === 'dictator' && (role !== 'dictator' && role !== 'admin')) return <Navigate to="/" replace />;
    if (requiredRole !== 'dictator' && role !== requiredRole) return <Navigate to="/" replace />;

    if (requiredRole === 'dictator') return <AdminDashboard />;
    if (requiredRole === 'editor') return <div className="min-h-screen bg-black pt-20 text-white"><ManageNews /></div>;
    return <TeamBuilder />;
}