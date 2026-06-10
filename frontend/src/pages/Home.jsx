import { useLeague } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { GlassPanel } from '../components/GlassPanel';
import { FormGuide } from '../components/FormGuide';
import { NewsArticle } from '../components/NewsArticle';
import { ChevronRight, Trophy, Goal, Zap, Loader2, Calendar } from 'lucide-react';
import { Loader } from '../components/Loader';
import { Link, useNavigate } from 'react-router-dom'; // <-- IMPORT LINK and useNavigate HERE
import './DashboardGrid.css';
import teamStyles from './Teams.module.css';
import { cn } from '../utils/cn';

const getTeamColorClass = (teamName) => {
    if (!teamName) return teamStyles.defaultTeam;
    const cleanName = teamName.trim();
    const map = {
        'KFC': teamStyles.kfc,
        'HRZxKadayadis': teamStyles.hrzx,
        'MILF': teamStyles.milf,
        'BBC': teamStyles.bbc,
        'AL Balal': teamStyles.alBalal,
        'AC Nilan': teamStyles.acNilan,
        'Red Wolves': teamStyles.redWolves,
        'DILF': teamStyles.dilf,
        'FAAAH United': teamStyles.faaah,
        'KULASTHREE FC': teamStyles.kulasthree,
        'Fivestars': teamStyles.fivestars
    };
    return map[cleanName] || teamStyles.defaultTeam;
};

function SectionHeader({ title, action, onAction }) {
    return (
        <div className="flex items-end justify-between px-2 pb-2">
            <div className="flex items-center gap-3">
                <div className="w-1.5 h-6 bg-gradient-to-b from-white to-zinc-600 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.2)]"></div>
                <h3 className="text-2xl sm:text-3xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400 uppercase">
                    {title}
                </h3>
            </div>
            <button
                onClick={onAction}
                className="text-[10px] sm:text-xs font-bold tracking-widest uppercase text-zinc-500 hover:text-white flex items-center transition-colors group mb-1"
            >
                {action} <ChevronRight size={14} className="transition-transform group-hover:translate-x-1" />
            </button>
        </div>
    );
}

export function Home() {
    const { division, setView } = useLeague();
    const { data: apiResponse, loading, error } = useApi('/home/dashboard');
    const navigate = useNavigate(); // <-- ADD useNavigate hook

    if (loading) {
        return <Loader variant="spinner" fullScreen text="Aggregating Live Data..." />;
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-red-500/80 space-y-4">
                <span className="font-black tracking-[0.3em] uppercase text-sm">Dashboard Feed Offline</span>
            </div>
        );
    }

    const data = apiResponse?.data || {};
    const match = data.liveMatch;
    const top4 = data.standings || [];
    const newsItems = data.news || [];
    const fantasyTop = data.fantasyTop || [];
    const topScorer = data.topScorer;
    const topAssist = data.topAssist;

    return (
        <div data-testid="page-home" className="space-y-12 animate-in fade-in duration-500 pb-12 overflow-x-hidden">

            {match ? (
                <GlassPanel
                    className="p-8 sm:p-12 md:p-20 relative overflow-hidden border border-white/20 animate-fade-up opacity-0 stagger-1 cursor-pointer hover:bg-white/5 transition-colors group"
                    onClick={() => navigate('/matches')} // <-- UPDATE TO navigate
                >
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-white/5 blur-[120px] rounded-full pointer-events-none mix-blend-screen" />

                    <div className="relative z-10 flex flex-col items-center">
                        {match.status === 'live' || match.status === 'completed' ? (
                            <div className="flex items-center gap-4 mb-10 sm:mb-16 px-6 py-2.5 rounded-full bg-black/80 border border-white/20 backdrop-blur-xl shadow-[0_0_30px_rgba(255,255,255,0.05)]">
                                {match.status === 'live' && (
                                    <div className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                                    </div>
                                )}
                                <span className={`text-xs sm:text-sm font-black tracking-[0.3em] ${match.status === 'live' ? 'text-white' : 'text-zinc-400'}`}>
                                    {match.minute === 'HT' ? 'HALF TIME'
                                        : match.minute === 'FT' ? 'FULL TIME'
                                            : match.status === 'live' ? `LIVE • ${match.minute && match.minute !== "LIVE" ? match.minute : "1'"}`
                                                : 'FULL TIME'}
                                </span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-4 mb-10 sm:mb-16 px-6 py-2.5 rounded-full bg-black/80 border border-white/10 backdrop-blur-xl">
                                <Calendar size={14} className="text-zinc-400" />
                                <span className="text-xs sm:text-sm font-black tracking-[0.2em] text-zinc-300 uppercase">
                                    UPCOMING &bull; {new Date(match.date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        )}

                        <div className="w-full flex justify-between items-start px-0 md:px-8">
                            <div className="flex flex-col items-center gap-4 sm:gap-6 w-1/3 pt-4">
                                <h2 className="text-xl sm:text-4xl lg:text-5xl font-black text-center tracking-tighter leading-none text-white drop-shadow-lg uppercase">{match.homeTeam}</h2>
                                <div className="hidden sm:block opacity-80 scale-110 origin-top"><FormGuide form={match.homeForm} /></div>
                                {match.homeScorers?.length > 0 && (
                                    <ul className="flex flex-col items-center gap-1.5 mt-2 text-xs sm:text-sm font-bold text-zinc-400 uppercase tracking-widest">
                                        {match.homeScorers.map((scorer, i) => (
                                            <li key={i} className="flex items-center gap-1.5">
                                                <Goal size={10} className="text-zinc-500" />
                                                <span>{scorer.name}</span>
                                                {scorer.minute && <span className="text-[10px] text-zinc-600">{scorer.minute}'</span>}
                                                {scorer.isOwnGoal && <span className="text-[9px] bg-red-500/20 text-red-500 px-1 rounded-sm">OG</span>}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <div className="text-4xl sm:text-7xl lg:text-9xl font-black tracking-tighter w-1/3 text-center tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-zinc-600 drop-shadow-2xl pt-2">
                                {match.status === 'live' ? (
                                    <>{match.homeScore}<span className="text-zinc-700 mx-2 sm:mx-4">-</span>{match.awayScore}</>
                                ) : (
                                    <span className="text-5xl lg:text-7xl text-zinc-700">VS</span>
                                )}
                            </div>

                            <div className="flex flex-col items-center gap-4 sm:gap-6 w-1/3 pt-4">
                                <h2 className="text-xl sm:text-4xl lg:text-5xl font-black text-center tracking-tighter leading-none text-zinc-400 drop-shadow-lg uppercase">{match.awayTeam}</h2>
                                <div className="hidden sm:block opacity-80 scale-110 origin-top"><FormGuide form={match.awayForm} /></div>
                                {match.awayScorers?.length > 0 && (
                                    <ul className="flex flex-col items-center gap-1.5 mt-2 text-xs sm:text-sm font-bold text-zinc-500 uppercase tracking-widest">
                                        {match.awayScorers.map((scorer, i) => (
                                            <li key={i} className="flex items-center gap-1.5">
                                                <Goal size={10} className="text-zinc-600" />
                                                <span>{scorer.name}</span>
                                                {scorer.minute && <span className="text-[10px] text-zinc-600">{scorer.minute}'</span>}
                                                {scorer.isOwnGoal && <span className="text-[9px] bg-red-500/20 text-red-500 px-1 rounded-sm">OG</span>}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </div>
                </GlassPanel>
            ) : (
                <GlassPanel
                    className="p-12 relative overflow-hidden border border-white/10 animate-fade-up flex justify-center items-center cursor-pointer hover:bg-white/5 transition-colors group"
                    onClick={() => navigate('/matches')} // <-- UPDATE TO navigate
                >
                    <span className="text-sm font-black tracking-[0.3em] uppercase text-zinc-500 group-hover:text-zinc-400 transition-colors">No Fixtures Currently Scheduled</span>
                </GlassPanel>
            )}

            <div className="dashboard-grid">

                <div className="bento-standings animate-slide-right opacity-0 stagger-2">
                    <SectionHeader
                        title={division === 'womens' ? "Road to Final" : "Top 4 Standings"}
                        action={division === 'womens' ? "Full Bracket" : "Full Table"}
                        onAction={() => navigate('/standings')} // <-- UPDATE TO navigate
                    />
                    <GlassPanel className="overflow-hidden relative h-fit">
                        {division === 'womens' ? (
                            <div className="p-6 sm:p-10 flex flex-col justify-center relative group cursor-pointer hover:bg-white/5 transition-colors overflow-hidden" onClick={() => navigate('/standings')}>
                                <Trophy className="absolute right-[-20px] bottom-[-20px] w-64 h-64 text-white/[0.03] -rotate-12 group-hover:scale-110 transition-transform duration-700 pointer-events-none animate-float" />
                                <h4 className="text-sm font-black text-zinc-500 tracking-widest uppercase mb-6 relative z-10">Final Result &bull; WSL</h4>
                                <div className="space-y-4 relative z-10 w-full max-w-sm">
                                    <div className="flex justify-between items-center bg-black/60 rounded-xl p-5 border border-white/10 shadow-lg">
                                        <span className="font-black text-white text-lg sm:text-2xl tracking-tighter uppercase truncate">FAAAH United</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-black/60 rounded-xl p-5 border border-white/10 shadow-lg">
                                        <span className="font-black text-zinc-500 text-lg sm:text-2xl tracking-tighter uppercase truncate">KULASTHREE FC</span>
                                    </div>
                                </div>
                                <div className="mt-8 text-xs font-bold text-zinc-400 uppercase flex items-center gap-2 tracking-widest group-hover:text-white transition-colors">
                                    View Tournament Tree <ChevronRight size={14} />
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col w-full overflow-x-auto">
                                <div className="min-w-[400px]">
                                    <div className="grid grid-cols-[3rem_minmax(120px,1fr)_3rem_3rem] gap-2 p-4 border-b border-white/10 text-[10px] sm:text-xs font-black tracking-widest text-zinc-500 bg-black/60 uppercase">
                                        <div className="text-center">Rnk</div>
                                        <div>Club</div>
                                        <div className="text-right">GD</div>
                                        <div className="text-right text-white mr-2">Pts</div>
                                    </div>
                                    <div className="flex flex-col">
                                        {top4.map((team, idx) => (
                                            <div key={team.teamId} className={`grid grid-cols-[3rem_minmax(120px,1fr)_3rem_3rem] gap-2 p-4 sm:p-5 items-center ${idx !== top4.length - 1 ? 'border-b border-white/5' : ''} hover:bg-white/10 transition-colors cursor-pointer`} onClick={() => navigate('/standings')}>
                                                <div className="font-mono text-base sm:text-lg font-black text-center text-zinc-400">{team.rank}</div>
                                                <div className="font-black text-sm sm:text-lg tracking-tight text-white uppercase flex items-center gap-2 min-w-0 pr-2">
                                                    {team.logoUrl && <img src={team.logoUrl} className="w-5 h-5 sm:w-6 sm:h-6 object-contain shrink-0" alt={team.teamName} />}
                                                    <span className="truncate" title={team.teamName}>{team.teamName}</span>
                                                </div>
                                                <div className="text-right text-zinc-500 font-mono font-bold text-sm sm:text-base">
                                                    {team.stats?.goalDifference > 0 ? `+${team.stats?.goalDifference}` : team.stats?.goalDifference}
                                                </div>
                                                <div className="text-right font-black text-xl sm:text-2xl text-transparent bg-clip-text bg-gradient-to-l from-white to-zinc-400 mr-2">
                                                    {team.stats?.points}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </GlassPanel>
                </div>
                <div className="bento-news animate-slide-right opacity-0 stagger-3">
                    <SectionHeader
                        title="The Onion Drops"
                        action="The Vault"
                        onAction={() => navigate('/vault')} // <-- UPDATE TO navigate
                    />
                    <div className="news-grid">
                        {newsItems.map((article, idx) => (
                            // <-- WRAPPED IN A LINK COMPONENT HERE
                            <Link
                                key={article.id || idx}
                                to={`/article/${article.id}`}
                                className="block hover:scale-[1.02] transition-transform duration-300"
                            >
                                <NewsArticle article={article} />
                            </Link>
                        ))}
                    </div>
                </div>
                <div className="bento-stats animate-fade-up opacity-0 stagger-4">
                    <SectionHeader
                        title="Player Leaders"
                        action="All Players"
                        onAction={() => navigate('/leaderboard')} // <-- UPDATE TO navigate
                    />
                    <div className="flex flex-col gap-4">
                        {topScorer && (
                            <GlassPanel className="p-6 relative overflow-hidden group min-w-0 cursor-pointer hover:bg-white/5 transition-colors" onClick={() => {
                                if (topScorer.playerId) {
                                    sessionStorage.setItem('selectedPlayer', JSON.stringify({ id: topScorer.playerId }));
                                    // Notice: Currently you don't have a specific route mapped for the player profile modal. 
                                    // You'll need to handle this based on how you implement player modals in React Router!
                                    // For now, I'm leaving setView so it doesn't break, but ideally you'd use query params or a modal route.
                                    setView('player-profile');
                                }
                            }}>
                                <Goal className="absolute -right-4 -bottom-4 w-32 h-32 text-white/5 -rotate-12 group-hover:scale-110 transition-transform duration-700 pointer-events-none animate-float" />
                                <h4 className="text-[10px] font-black tracking-widest text-zinc-500 uppercase mb-4 truncate">Golden Boot</h4>
                                <div className="relative z-10">
                                    <div className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-1 truncate">{topScorer.club}</div>
                                    <div className="text-2xl font-black text-white leading-none tracking-tight mb-6 truncate">{topScorer.name}</div>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">{topScorer.stat}</span>
                                        <span className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Goals</span>
                                    </div>
                                </div>
                            </GlassPanel>
                        )}

                        {topAssist && (
                            <GlassPanel className="p-6 relative overflow-hidden group min-w-0 cursor-pointer hover:bg-white/5 transition-colors" onClick={() => {
                                if (topAssist.playerId) {
                                    sessionStorage.setItem('selectedPlayer', JSON.stringify({ id: topAssist.playerId }));
                                    setView('player-profile');
                                }
                            }}>
                                <Zap className="absolute -right-4 -bottom-4 w-32 h-32 text-white/5 -rotate-12 group-hover:scale-110 transition-transform duration-700 pointer-events-none animate-float" />
                                <h4 className="text-[10px] font-black tracking-widest text-zinc-500 uppercase mb-4 truncate">Playmaker</h4>
                                <div className="relative z-10">
                                    <div className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-1 truncate">{topAssist.club}</div>
                                    <div className="text-2xl font-black text-white leading-none tracking-tight mb-6 truncate">{topAssist.name}</div>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">{topAssist.stat}</span>
                                        <span className="text-sm font-bold text-zinc-500 uppercase tracking-widest whitespace-nowrap">Assists</span>
                                    </div>
                                </div>
                            </GlassPanel>
                        )}
                    </div>
                </div>

                <div className="bento-fantasy animate-fade-up opacity-0 stagger-5">
                    <SectionHeader
                        title="Fantasy Snapshot"
                        action="Play Predictor"
                        onAction={() => navigate('/fantasy')} // <-- UPDATE TO navigate
                    />
                    <GlassPanel className="p-2 overflow-hidden h-fit flex flex-col justify-center">
                        {fantasyTop.map((user, idx) => (
                            <div key={user.id} className={`flex items-center justify-between p-4 ${idx !== fantasyTop.length - 1 ? 'border-b border-white/5' : ''}`}>
                                <div className="flex items-center gap-4 min-w-0">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm shrink-0 ${idx === 0 ? 'bg-white text-black' : 'bg-white/5 text-zinc-400'}`}>
                                        {idx + 1}
                                    </div>
                                    <div className="flex flex-col items-start leading-tight min-w-0">
                                        <span className="font-bold text-md text-white uppercase tracking-wider truncate">{user.name}</span>
                                        {user.mens_team_flair && (
                                            <span className={cn("px-2 py-[2px] mt-1 rounded-full text-[10px] text-white font-bold leading-none tracking-wide shadow-sm border border-white/10 shrink-0 inline-block", getTeamColorClass(division === 'mens' ? user.mens_team_flair : user.womens_team_flair))}>
                                                {division === 'mens' ? user.mens_team_flair : user.womens_team_flair}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-black text-xl text-zinc-300">{user.points.toLocaleString()}</span>
                                    <span className="text-[10px] font-bold text-zinc-600 uppercase">PTS</span>
                                </div>
                            </div>
                        ))}
                        <div
                            className="text-center p-3 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white cursor-pointer transition-colors mt-2"
                            onClick={() => {
                                navigate('/fantasy');
                                setTimeout(() => document.getElementById('leaderboard')?.scrollIntoView({ behavior: 'smooth' }), 100);
                            }}
                        >
                            View Global Leaderboard
                        </div>
                    </GlassPanel>
                </div>

            </div>
        </div>
    );
}
