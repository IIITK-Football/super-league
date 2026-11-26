import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LeagueProvider } from './context/LeagueContext';
import { ConfirmProvider } from './components/ui';
import { AppShell } from './components/shell/AppShell';
import { Loader } from './components/Loader';
import { useLocation } from 'react-router-dom';
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { GlobalAuthRedirect } from './components/GlobalAuthRedirect';

// Pages
import { Home } from './pages/Home';
import { Standings } from './pages/Standings';
import { Teams } from './pages/Teams';
import { Fantasy } from './pages/Fantasy';
import { Leaderboard } from './pages/Leaderboard';
import { ArticleView } from './pages/ArticleView';
import { AdminLogin } from './pages/AdminLogin';
import { Onboarding } from './pages/Onboarding';
import { UserProfile } from './pages/UserProfile'; // <-- FIXED: Added this missing import!

// Additional Section Pages
import { Matches } from './pages/Matches';
import { Vault } from './pages/Vault';
import { Rules } from './pages/Rules';
import { LeagueLanding } from './pages/LeagueLanding';
import { NotFound } from './pages/NotFound';
import { RoleWorkspace } from './pages/RoleWorkspace';
import { LEGACY_REDIRECTS, LegacyRedirect } from './routes/legacyRedirects';
import { DivisionHomeRoute } from './pages/DivisionHomeRoute';
import { SectionGate } from './pages/SectionGate';
import MatchTimeline from './components/MatchTimeline';

import { lazy, Suspense, useEffect } from 'react';
import { useLeague } from './context/LeagueContext';
// A smart wrapper to protect routes that require login
function ProtectedRoute({ children }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="min-h-screen bg-bg flex justify-center items-center"><Loader /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  
  if (!profile?.nickname || !profile?.wc_team_flair) return <Onboarding />;

  return <AppShell>{children}</AppShell>;
}

// A wrapper for public routes (they get the app shell too)
function PublicRoute({ children }) {
  return <AppShell>{children}</AppShell>;
}

// The developer-only page that renders every UI primitive in both themes (not in production builds).
const DevUi = import.meta.env.DEV ? lazy(() => import('./pages/DevUi')) : null;

function WcRoute() {
  const { setFantasySection } = useLeague();
  
  useEffect(() => {
    setFantasySection('fifa');
  }, [setFantasySection]);

  return <Fantasy />;
}

function LeagueDashboardRoute() {
  return <PublicRoute><DivisionHomeRoute><Home /></DivisionHomeRoute></PublicRoute>;
}

function App() {
  return (
    <AuthProvider>
      <LeagueProvider>
        <ConfirmProvider>
        <BrowserRouter>
        <GlobalAuthRedirect />
          <Routes>
            {/* Admin Routes (No Standard Navbar) */}
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/hq-login" element={<AdminLogin />} />
            {LEGACY_REDIRECTS.map(({ from, to }) => <Route key={from} path={from} element={<LegacyRedirect to={to} />} />)}

            {/* Public App Routes */}
            <Route path="/" element={<LeagueLanding />} />
            <Route path="/:division" element={<LeagueDashboardRoute />} />
            <Route path="/:division/:season" element={<LeagueDashboardRoute />} />
            <Route path="/team-builder" element={<AppShell><RoleWorkspace requiredRole="captain" /></AppShell>} />
            <Route path="/editor" element={<AppShell><RoleWorkspace requiredRole="editor" /></AppShell>} />
            <Route path="/dictator" element={<AppShell><RoleWorkspace requiredRole="dictator" /></AppShell>} />
            {DevUi && <Route path="/dev/ui" element={<Suspense fallback={null}><DevUi /></Suspense>} />}
            <Route path="/standings" element={<Navigate to="/standings/super-league" replace />} />
            <Route path="/standings/:division" element={<PublicRoute><SectionGate section="standings"><Standings /></SectionGate></PublicRoute>} />
            <Route path="/teams" element={<PublicRoute><SectionGate section="teams"><Teams /></SectionGate></PublicRoute>} />
            
            {/* Navigation Sections */}
            <Route path="/matches" element={<PublicRoute><SectionGate section="fixtures"><Matches /></SectionGate></PublicRoute>} />
            <Route path="/matches/:id" element={<PublicRoute><MatchTimeline /></PublicRoute>} />
            <Route path="/vault" element={<PublicRoute><SectionGate section="news"><Vault /></SectionGate></PublicRoute>} />
            <Route path="/rules" element={<PublicRoute><SectionGate section="rules"><Rules /></SectionGate></PublicRoute>} />
            
            {/* Note the :id syntax! This catches /article/12345 */}
            <Route path="/article/:id" element={<PublicRoute><SectionGate section="news"><ArticleView /></SectionGate></PublicRoute>} />

            <Route path="/wc" element={<PublicRoute><WcRoute /></PublicRoute>} />
            
            {/* Protected Routes (Require Login/Profile) */}
            <Route path="/fantasy" element={<ProtectedRoute><SectionGate section="fantasy"><Fantasy /></SectionGate></ProtectedRoute>} />
            <Route path="/leaderboard" element={<ProtectedRoute><SectionGate section="stats"><Leaderboard /></SectionGate></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
            
            {/* Catch-all for bad URLs */}
            <Route path="*" element={<PublicRoute><NotFound /></PublicRoute>} />
          </Routes>
        </BrowserRouter>
        </ConfirmProvider>
      </LeagueProvider>
    </AuthProvider>
  );
}

export default App;
