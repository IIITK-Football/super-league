import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LeagueProvider } from './context/LeagueContext';
import { TopNavbar } from './components/TopNavbar';
import { Loader } from './components/Loader';
import { useLocation } from 'react-router-dom';
import { Login } from './pages/Login';

// Pages
import { Home } from './pages/Home';
import { Standings } from './pages/Standings';
import { Teams } from './pages/Teams';
import { Fantasy } from './pages/Fantasy';
import { Leaderboard } from './pages/Leaderboard';
import { ArticleView } from './pages/ArticleView';
import { AdminLogin } from './pages/AdminLogin';
import { AdminDashboard } from './pages/AdminDashboard';
import { Onboarding } from './pages/Onboarding';
import { UserProfile } from './pages/UserProfile'; // <-- FIXED: Added this missing import!

// Additional Section Pages
import { Matches } from './pages/Matches';
import { Vault } from './pages/Vault';
import { Rules } from './pages/Rules';
import { LeagueLanding } from './pages/LeagueLanding';
import { TeamBuilder } from './pages/TeamBuilder';
import { RoleWorkspace } from './pages/RoleWorkspace';

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from './context/LeagueContext';
// A smart wrapper to protect routes that require login
function ProtectedRoute({ children }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="min-h-screen bg-black flex justify-center items-center"><Loader /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  
  if (!profile?.nickname || !profile?.wc_team_flair) return <Onboarding />;

  const isWc = location.pathname === '/wc';

  return (
    <div className={`min-h-screen pt-24 pb-12 px-4 sm:px-6 mx-auto ${isWc ? 'max-w-full' : 'max-w-7xl'}`}>
      <TopNavbar />
      <main className="animate-in fade-in duration-500">{children}</main>
    </div>
  );
}

// A wrapper for public routes (so they still get the Navbar)
function PublicRoute({ children }) {
  return (
    <div className="min-h-screen pt-24 pb-12 px-4 sm:px-6 mx-auto max-w-7xl">
      <TopNavbar />
      <main className="animate-in fade-in duration-500">{children}</main>
    </div>
  );
}

function GlobalAuthRedirect() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Whenever a user logs in, check if they had a saved destination!
    if (user && location.pathname !== '/login') {
      const redirectUrl = sessionStorage.getItem('authRedirect');
      if (redirectUrl) {
        sessionStorage.removeItem('authRedirect'); // Clean up
        navigate(redirectUrl, { replace: true }); // Send them there!
      }
    }
  }, [user, navigate, location.pathname]);

  return null; // This component renders nothing visually
}

function WcRoute() {
  const { setFantasySection } = useLeague();
  
  useEffect(() => {
    setFantasySection('fifa');
  }, [setFantasySection]);

  return <Fantasy />;
}

function LeagueDashboardRoute({ division }) {
  const { setDivision } = useLeague();

  useEffect(() => {
    setDivision(division);
  }, [division, setDivision]);

  return <PublicRoute><Home /></PublicRoute>;
}

function AuthenticatedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-black" />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}


function App() {
  return (
    <AuthProvider>
      <LeagueProvider>
        <BrowserRouter>
        <GlobalAuthRedirect />
          <Routes>
            {/* Admin Routes (No Standard Navbar) */}
            <Route path="/login" element={<Login />} />
            <Route path="/hq-login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminDashboard />} />

            {/* Public App Routes */}
            <Route path="/" element={<LeagueLanding />} />
            <Route path="/super-league" element={<LeagueDashboardRoute division="mens" />} />
            <Route path="/wsl" element={<LeagueDashboardRoute division="womens" />} />
            <Route path="/freshers" element={<LeagueDashboardRoute division="freshers" />} />
            <Route path="/team-builder" element={<RoleWorkspace requiredRole="captain" />} />
            <Route path="/editor" element={<RoleWorkspace requiredRole="editor" />} />
            <Route path="/dictator" element={<RoleWorkspace requiredRole="dictator" />} />
            <Route path="/standings" element={<Navigate to="/standings/mens" replace />} />
            <Route path="/standings/:division" element={<PublicRoute><Standings /></PublicRoute>} />
            <Route path="/teams" element={<PublicRoute><Teams /></PublicRoute>} />
            
            {/* Navigation Sections */}
            <Route path="/matches" element={<PublicRoute><Matches /></PublicRoute>} />
            <Route path="/vault" element={<PublicRoute><Vault /></PublicRoute>} />
            <Route path="/rules" element={<PublicRoute><Rules /></PublicRoute>} />
            
            {/* Note the :id syntax! This catches /article/12345 */}
            <Route path="/article/:id" element={<PublicRoute><ArticleView /></PublicRoute>} />

            <Route path="/wc" element={<PublicRoute><WcRoute /></PublicRoute>} />
            
            {/* Protected Routes (Require Login/Profile) */}
            <Route path="/fantasy" element={<ProtectedRoute><Fantasy /></ProtectedRoute>} />
            <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
            
            {/* Catch-all for bad URLs */}
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </BrowserRouter>
      </LeagueProvider>
    </AuthProvider>
  );
}

export default App;
