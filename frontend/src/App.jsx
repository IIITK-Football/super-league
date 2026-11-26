import { Navigate, Outlet, Route, RouterProvider, createBrowserRouter, createRoutesFromElements, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LeagueProvider } from './context/LeagueContext';
import { ConfirmProvider } from './components/ui';
import { AppShell } from './components/shell/AppShell';
import { Loader } from './components/Loader';
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { GlobalAuthRedirect } from './components/GlobalAuthRedirect';
import { ErrorState } from './components/ui';

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
// Protects routes that need a signed-in account with a nickname. A failed profile load is an error with a retry, not a
// request to set up a profile that may already exist.
export function ProtectedRoute({ children }) {
  const { user, profile, profileError, loading, retryAuth } = useAuth();
  const location = useLocation();

  if (loading) return <div className="min-h-screen bg-bg flex justify-center items-center"><Loader /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (profileError) {
    return <div className="min-h-screen bg-bg p-4 flex items-center justify-center"><ErrorState title="Could not load your profile" message="Check your connection, then try again." onRetry={retryAuth} className="max-w-md w-full" /></div>;
  }
  if (!profile?.nickname) return <Onboarding />;

  return <AppShell>{children}</AppShell>;
}

// A wrapper for public routes (they get the app shell too)
function PublicRoute({ children }) {
  return <AppShell>{children}</AppShell>;
}

// The developer-only page that renders every UI primitive in both themes (not in production builds).
const DevUi = import.meta.env.DEV ? lazy(() => import('./pages/DevUi')) : null;

// A division in the address (/<division>/matches and so on) sets the division the page reads. It renders nothing for
// the one render before the division is set, so a page never fetches another division's data.
function DivisionScope({ children }) {
  const { division: urlDivision } = useParams();
  const { division, setDivision } = useLeague();

  useEffect(() => {
    setDivision(urlDivision);
  }, [urlDivision, setDivision]);

  return urlDivision === division ? children : null;
}

// Old division-less addresses (/matches, /vault, /rules, /teams) open the same page in the division in view.
function DivisionRedirect({ to }) {
  const { division } = useLeague();
  const { search } = useLocation();
  return <Navigate to={`/${division}/${to}${search}`} replace />;
}

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

// Routes live in one data router so useBlocker (for unsaved edits) works anywhere in the tree.
const routes = createRoutesFromElements(
  <Route element={<><GlobalAuthRedirect /><Outlet /></>}>
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

    {/* Division sections: the division is in the address */}
    <Route path="/:division/matches" element={<DivisionScope><PublicRoute><SectionGate section="fixtures"><Matches /></SectionGate></PublicRoute></DivisionScope>} />
    <Route path="/:division/teams" element={<DivisionScope><PublicRoute><SectionGate section="teams"><Teams /></SectionGate></PublicRoute></DivisionScope>} />
    <Route path="/:division/teams/:teamId" element={<DivisionScope><PublicRoute><SectionGate section="teams"><Teams /></SectionGate></PublicRoute></DivisionScope>} />
    <Route path="/:division/news" element={<DivisionScope><PublicRoute><SectionGate section="news"><Vault /></SectionGate></PublicRoute></DivisionScope>} />
    <Route path="/:division/rules" element={<DivisionScope><PublicRoute><SectionGate section="rules"><Rules /></SectionGate></PublicRoute></DivisionScope>} />
    <Route path="/matches" element={<DivisionRedirect to="matches" />} />
    <Route path="/teams" element={<DivisionRedirect to="teams" />} />
    <Route path="/vault" element={<DivisionRedirect to="news" />} />
    <Route path="/rules" element={<DivisionRedirect to="rules" />} />
    <Route path="/matches/:id" element={<PublicRoute><MatchTimeline /></PublicRoute>} />

    {/* Note the :id syntax! This catches /article/12345 */}
    <Route path="/article/:id" element={<PublicRoute><SectionGate section="news"><ArticleView /></SectionGate></PublicRoute>} />

    <Route path="/wc" element={<PublicRoute><WcRoute /></PublicRoute>} />

    {/* Protected Routes (Require Login/Profile) */}
    <Route path="/fantasy" element={<ProtectedRoute><SectionGate section="fantasy"><Fantasy /></SectionGate></ProtectedRoute>} />
    <Route path="/leaderboard" element={<PublicRoute><SectionGate section="stats"><Leaderboard /></SectionGate></PublicRoute>} />
    <Route path="/profile" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />

    {/* Catch-all for bad URLs */}
    <Route path="*" element={<PublicRoute><NotFound /></PublicRoute>} />
  </Route>,
);
const router = createBrowserRouter(routes);

function App() {
  return (
    <AuthProvider>
      <LeagueProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </LeagueProvider>
    </AuthProvider>
  );
}

export default App;
