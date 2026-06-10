import React, { useState, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { ArrowLeft, Shield, Loader2, Users, Calendar } from 'lucide-react';
import { Loader } from '../components/Loader';
import styles from './Teams.module.css';

const POSITION_ORDER = ['GK', 'DEF', 'MID', 'FWD'];
const POSITION_LABELS = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };

const getTeamColorClass = (teamName) => {
    if (!teamName) return styles.defaultTeam;

    const cleanName = teamName.trim();

    const map = {
        'KFC': styles.kfc,
        'HRZxKadayadis': styles.hrzx,
        'MILF': styles.milf,
        'BBC': styles.bbc,
        'AL Balal': styles.alBalal,
        'AC Nilan': styles.acNilan,
        'Red Wolves': styles.redWolves,
        'DILF': styles.dilf,
        'FAAAH United': styles.faaah,
        'KULASTHREE FC': styles.kulasthree,
        'Fivestars': styles.fivestars
    };
    return map[cleanName] || styles.defaultTeam;
};

function PlayerRow({ player, teamColor, onSelect }) {
    return (
        <div
            onClick={() => onSelect(player)}
            className="flex items-center gap-4 py-3 px-2 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors group rounded-lg"
        >
            <div className={`w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-white/10 ${teamColor}`}>
                {player.image_url ? (
                    <img src={player.image_url} alt={player.name} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Shield className="w-5 h-5 text-zinc-600" />
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <p className="font-bold text-white group-hover:text-zinc-200 transition-colors truncate">
                    {player.name}
                </p>
            </div>

            {player.jersey_number != null && (
                <span className="text-sm font-mono font-bold text-zinc-500 shrink-0">
                    #{player.jersey_number}
                </span>
            )}
        </div>
    );
}

function MatchCard({ match, teamId, onClick }) {
    const isHome = match.home_team_id === teamId;
    const opponent = isHome ? match.away_team : match.home_team;
    const curr = isHome ? match.home_team : match.away_team;

    const homeName = isHome ? curr : opponent;
    const awayName = !isHome ? curr : opponent;

    return (
        <div
            onClick={onClick}
            className="bg-[#1A1820] border border-white/5 hover:border-white/20 rounded-2xl p-4 sm:p-6 cursor-pointer hover:bg-white/5 transition-all group relative overflow-hidden"
        >
            <div className="flex justify-between items-center text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 sm:mb-6">
                <span className="flex items-center gap-1.5 sm:gap-2">
                    <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    {match.date ? new Date(match.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'TBA'}
                </span>
                <span className={match.status === 'live' ? 'text-red-500 animate-pulse' : 'text-zinc-400'}>
                    {match.status === 'live' ? `LIVE • ${match.minute || "1'"}` : match.status}
                </span>
            </div>

            <div className="flex items-center justify-between gap-2 sm:gap-4 w-full">
                <div className="flex-1 text-right flex flex-col justify-center">
                    <h3 className={`text-[13px] sm:text-xl md:text-2xl font-black uppercase tracking-tight leading-tight ${isHome ? 'text-white' : 'text-zinc-400'}`}>
                        {homeName}
                    </h3>
                </div>

                <div className="bg-black/60 px-3 py-2 sm:px-6 sm:py-3 rounded-xl border border-white/10 font-black text-xl sm:text-3xl tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-500 shadow-xl shrink-0">
                    {match.status === 'scheduled' ? 'VS' : `${match.home_score || 0} - ${match.away_score || 0}`}
                </div>

                <div className="flex-1 text-left flex flex-col justify-center">
                    <h3 className={`text-[13px] sm:text-xl md:text-2xl font-black uppercase tracking-tight leading-tight ${!isHome ? 'text-white' : 'text-zinc-400'}`}>
                        {awayName}
                    </h3>
                </div>
            </div>
        </div>
    );
}

function TeamOverview({ team, allPlayers, onBack, onSelectPlayer, onSelectMatch }) {
    const [activeTab, setActiveTab] = useState(() => {
        return sessionStorage.getItem('activeTeamTab') || 'matches';
    });

    const { data: matchesResp, loading: matchesLoading } = useApi(`/teams/${team.id}/matches`);
    const matches = matchesResp?.data || [];

    const teamColorClass = getTeamColorClass(team.name);

    const teamPlayers = useMemo(
        () => allPlayers.filter(p => p.team_id === team.id),
        [allPlayers, team.id]
    );

    const playersByPosition = useMemo(() => {
        const groups = {};
        for (const pos of POSITION_ORDER) {
            const inPos = teamPlayers.filter(p => p.position === pos);
            if (inPos.length > 0) groups[pos] = inPos;
        }
        teamPlayers.forEach(p => {
            if (!POSITION_ORDER.includes(p.position) && p.position) {
                if (!groups[p.position]) groups[p.position] = [];
                if (!groups[p.position].find(x => x.id === p.id)) groups[p.position].push(p);
            }
        });
        return groups;
    }, [teamPlayers]);

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl sm:text-5xl font-black tracking-tighter uppercase">
                    {team.name} <span className="text-zinc-600">Overview</span>
                </h1>
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 px-3 py-2 sm:px-4 border border-white/10 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-sm font-bold"
                >
                    <ArrowLeft size={16} />
                    <span className="hidden sm:inline">Back to Clubs</span>
                </button>
            </div>

            <div className="flex gap-1 bg-white/5 p-1 rounded-xl w-fit border border-white/10">
                {['matches', 'squad'].map(tab => (
                    <button
                        key={tab}
                        onClick={() => {
                            setActiveTab(tab);
                            sessionStorage.setItem('activeTeamTab', tab); // <-- Save it!
                        }}
                        className={`px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === tab ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                            }`}
                    >
                        {tab === 'squad' ? 'Squad' : 'Matches'}
                    </button>
                ))}
            </div>

            {activeTab === 'squad' ? (
                teamPlayers.length === 0 ? (
                    <div className="py-16 text-center border border-white/5 bg-white/5 rounded-2xl">
                        <Shield className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                        <p className="text-zinc-400 font-bold uppercase tracking-widest text-sm">No players registered yet.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                        {Object.entries(playersByPosition).map(([position, players]) => (
                            <div key={position}>
                                <h3 className="text-base font-bold text-white mb-3">
                                    {POSITION_LABELS[position] || position}
                                </h3>
                                <div>
                                    {players.map(player => (
                                        <PlayerRow key={player.id} player={player} teamColor={teamColorClass} onSelect={onSelectPlayer} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )
            ) : (
                <div className="space-y-4">
                    {matchesLoading ? (
                        <div className="flex items-center justify-center py-12 border border-white/5 bg-white/5 rounded-2xl">
                            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
                        </div>
                    ) : matches.length === 0 ? (
                        <div className="py-12 text-center border border-white/5 bg-white/5 rounded-2xl">
                            <Calendar className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                            <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">No matches found.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4">
                            {matches.map(match => (
                                <MatchCard
                                    key={match.id}
                                    match={match}
                                    teamId={team.id}
                                    onClick={() => onSelectMatch(match)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function Teams() {
    const { setView: setLeagueView } = useLeague();
    const [selectedTeam, setSelectedTeam] = useState(() => {
        const saved = sessionStorage.getItem('selectedTeam');
        return saved ? JSON.parse(saved) : null;
    });
    const [selectedPlayer, setSelectedPlayer] = useState(null);

    const { data: teamsResp, loading: teamsLoading, error: teamsError } = useApi('/teams');
    const { data: playersResp } = useApi('/players');

    const teams = useMemo(() => {
        const raw = teamsResp?.data || [];
        return raw.filter(t => t.name);
    }, [teamsResp]);

    const allPlayers = playersResp?.data || [];

    const handleSelectPlayer = (player) => {
        setSelectedPlayer(player);
        sessionStorage.setItem('selectedPlayer', JSON.stringify(player));
        setLeagueView('player-profile');
    };

    const handleSelectMatch = (match) => {
        sessionStorage.setItem('selectedMatch', JSON.stringify(match));
        sessionStorage.setItem('matchSource', 'teams');
        setLeagueView('matchTimeline');
    };

    if (teamsLoading) {
        return <Loader text="Loading Clubs..." />;
    }

    if (teamsError || teams.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-zinc-500 space-y-4">
                <Shield className="w-12 h-12 text-zinc-700" />
                <span className="font-black tracking-[0.3em] uppercase text-sm">No teams found</span>
            </div>
        );
    }

    if (selectedTeam) {
        return (
            <TeamOverview
                team={selectedTeam}
                allPlayers={allPlayers}
                onBack={() => {
                    setSelectedTeam(null);
                    sessionStorage.removeItem('selectedTeam');
                    sessionStorage.removeItem('activeTeamTab')
                }}
                onSelectPlayer={handleSelectPlayer}
                onSelectMatch={handleSelectMatch}
            />
        );
    }

    return (
        <div data-testid="page-clubs" className="space-y-6 animate-in fade-in duration-500 pb-12">
            <h1 className="text-3xl sm:text-5xl font-black tracking-tighter uppercase">
                Clubs <span className="text-zinc-600">Overview</span>
            </h1>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {teams.map((team) => {
                    const playerCount = allPlayers.filter(p => p.team_id === team.id).length;
                    return (
                        <div
                            key={team.id}
                            onClick={() => {
                                setSelectedTeam(team);
                                sessionStorage.setItem('selectedTeam', JSON.stringify(team));
                            }}
                            className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/10 shadow-lg hover:shadow-2xl transition-shadow duration-300"
                        >
                            <div
                                className={`absolute inset-0 opacity-80 group-hover:opacity-100 transition-opacity duration-300 ${getTeamColorClass(team.name)}`}
                            />
                            <div className="relative p-8 flex flex-col items-center justify-center text-center gap-3 h-52">
                                {team.logo_url ? (
                                    <img src={team.logo_url} alt={team.name} className="w-14 h-14 object-contain" />
                                ) : (
                                    <Shield className="w-12 h-12 text-white/80 group-hover:text-white transition-colors" />
                                )}
                                <h3 className="text-xl sm:text-2xl font-bold tracking-widest uppercase">{team.name}</h3>
                                {playerCount > 0 && (
                                    <span className="flex items-center gap-1 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                                        <Users size={12} /> {playerCount} Players
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
