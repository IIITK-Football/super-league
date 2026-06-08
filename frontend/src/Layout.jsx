import { useLeague } from './context/LeagueContext';
import { TopNavbar } from './components/TopNavbar';
import { Home } from './pages/Home';
import { Standings } from './pages/Standings';
import { Teams } from './pages/Teams';
import { Fantasy } from './pages/Fantasy';
import { Leaderboard } from './pages/Leaderboard';
import { Vault } from './pages/Vault';
import { Login } from './pages/Login';
import { UserProfile } from './pages/UserProfile';
import { ArticleView } from './pages/ArticleView';
import PlayerProfile from './components/PlayerProfile';
import { AdminDashboard } from './pages/AdminDashboard';
import { Matches } from './pages/Matches';
import MatchTimeline from './components/MatchTimeline'; 
import { Rules } from './pages/Rules';

export function Layout() {
  const { view } = useLeague();

  const renderView = () => {
    switch(view) {
      case 'home': return <Home />;
      case 'standings': return <Standings />;
      case 'teams': return <Teams />;
      case 'fantasy': return <Fantasy />;
      case 'leaderboard': return <Leaderboard />;
      case 'login': return <Login />;
      case 'profile': return <UserProfile />;
      case 'vault': return <Vault />;
      case 'article': return <ArticleView />;
      case 'player-profile': return <PlayerProfile />;
      case 'matches': return <Matches />;
      case 'matchTimeline': return <MatchTimeline />;
      case 'rules': return <Rules />;
      
      default:
        return (
          <div className="flex-1 flex items-center justify-center min-h-[50vh]">
            <h2 className="text-2xl text-zinc-500 tracking-widest uppercase">{view} - Coming Soon</h2>
          </div>
        );
    }
  };

  return (
    <div className={`min-h-screen pt-24 pb-12 px-4 sm:px-6 mx-auto selection:bg-white/20 ${view === 'fantasy' ? 'max-w-[1800px]' : 'max-w-7xl'}`}>
      <TopNavbar />
      <main className="animate-in fade-in zoom-in-95 duration-500">
        {renderView()}
      </main>
    </div>
  );
}