import { useLeague } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { GlassPanel } from '../components/GlassPanel';
import { cn } from '../utils/cn';
import { Loader2 } from 'lucide-react';
import { Loader } from '../components/Loader';

export function Leaderboard() {
    const { division } = useLeague();

    // Pass the division to the backend so it knows which stats to grab!
    const { data: apiResponse, loading } = useApi(`/leaderboard?division=${division}`);

    // Extract the separated lists directly from the new backend response
    const scorersData = apiResponse?.data?.topScorers || [];
    const assistsData = apiResponse?.data?.topAssists || [];

    // Map them so the UI component can read the 'stat' variable easily
    const topScorers = scorersData.map(p => ({ ...p, stat: p.goalsScored || 0 }));
    const topAssists = assistsData.map(p => ({ ...p, stat: p.assists || 0 }));

    if (loading) {
        return <Loader text="Aggregating Player Stats..." fullScreen />;
    }

    return (
        <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in duration-500 pb-12">
            {/* Header */}
            <div className="text-center space-y-4">
                <h1 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">
                    {division === 'mens' ? "Super League" : division === 'freshers' ? "Freshers" : "WSL"} Player Stats
                </h1>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
                {/* Top Scorers Section */}
                <GlassPanel className="p-6 sm:p-10 flex flex-col h-full">
                    <div className="flex items-center gap-4 mb-8">
                        <div>
                            <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-widest text-white">Golden Boot</h2>
                            <p className="text-zinc-400 text-sm tracking-wider uppercase">Top Goalscorers</p>
                        </div>
                    </div>

                    <div className="space-y-4 flex-1">
                        <div className="grid grid-cols-[3rem_1fr_4rem] gap-4 px-4 pb-2 border-b border-white/10 text-xs font-bold tracking-widest text-zinc-500">
                            <div className="text-center">RNK</div>
                            <div>PLAYER</div>
                            <div className="text-right">GLS</div>
                        </div>

                        {topScorers.length > 0 ? topScorers.map((player, index) => (
                            <div
                                key={`scorer-${player.id || index}`}
                                className={cn(
                                    "grid grid-cols-[3rem_1fr_4rem] gap-4 items-center p-4 rounded-2xl transition-all duration-300",
                                    index === 0 ? "bg-white/5 border border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.05)]" : "bg-black/40 hover:bg-white/5 border border-white/5"
                                )}
                            >
                                <div className={cn(
                                    "font-black text-xl text-center",
                                    index === 0 ? "text-white" : "text-zinc-500"
                                )}>
                                    {index + 1}
                                </div>
                                <div>
                                    <h4 className="font-bold text-lg text-white transition-colors">{player.name}</h4>
                                    <p className="text-sm font-medium text-zinc-400 truncate">{player.club}</p>
                                </div>
                                <div className="text-right">
                                    <span className={cn(
                                        "text-2xl font-black",
                                        index === 0 ? "text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-400 drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" : "text-white"
                                    )}>
                                        {player.stat}
                                    </span>
                                </div>
                            </div>
                        )) : (
                            <div className="text-center py-10 text-zinc-600 font-bold uppercase tracking-widest text-sm">No goals recorded yet</div>
                        )}
                    </div>
                </GlassPanel>

                {/* Top Assists Section */}
                <GlassPanel className="p-6 sm:p-10 flex flex-col h-full">
                    <div className="flex items-center gap-4 mb-8">
                        <div>
                            <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-widest text-white">Playmaker</h2>
                            <p className="text-zinc-400 text-sm tracking-wider uppercase">Top Assists</p>
                        </div>
                    </div>

                    <div className="space-y-4 flex-1">
                        <div className="grid grid-cols-[3rem_1fr_4rem] gap-4 px-4 pb-2 border-b border-white/10 text-xs font-bold tracking-widest text-zinc-500">
                            <div className="text-center">RNK</div>
                            <div>PLAYER</div>
                            <div className="text-right">AST</div>
                        </div>

                        {topAssists.length > 0 ? topAssists.map((player, index) => (
                            <div
                                key={`assist-${player.id || index}`}
                                className={cn(
                                    "grid grid-cols-[3rem_1fr_4rem] gap-4 items-center p-4 rounded-2xl transition-all duration-300",
                                    index === 0 ? "bg-white/5 border border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.05)]" : "bg-black/40 hover:bg-white/5 border border-white/5"
                                )}
                            >
                                <div className={cn(
                                    "font-black text-xl text-center",
                                    index === 0 ? "text-white" : "text-zinc-500"
                                )}>
                                    {index + 1}
                                </div>
                                <div>
                                    <h4 className="font-bold text-lg text-white transition-colors">{player.name}</h4>
                                    <p className="text-sm font-medium text-zinc-400 truncate">{player.club}</p>
                                </div>
                                <div className="text-right">
                                    <span className={cn(
                                        "text-2xl font-black",
                                        index === 0 ? "text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-400 drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" : "text-white"
                                    )}>
                                        {player.stat}
                                    </span>
                                </div>
                            </div>
                        )) : (
                            <div className="text-center py-10 text-zinc-600 font-bold uppercase tracking-widest text-sm">No assists recorded yet</div>
                        )}
                    </div>
                </GlassPanel>
            </div>

        </div >
    );
}
