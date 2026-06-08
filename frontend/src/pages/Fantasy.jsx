import { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { useAuth } from '../context/AuthContext';
import { FifaPrediction } from './FifaPrediction';
import { useApi } from '../hooks/useApi';
import { fetchApi } from '../hooks/useApi';
import { Send, CheckCircle2, RefreshCw, Loader2, Crown, Lock, Target, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../utils/cn';
import { Login } from './Login';
import { supabase } from '../lib/supabase';
import { Loader } from '../components/Loader';
import styles from './Teams.module.css';

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

export function Fantasy() {
    const { division, fantasySection, setFantasySection } = useLeague();
    const { user, profile } = useAuth();
    

    // --- Data fetching ---
    const { data: scheduleResp, loading: scheduleLoading } = useApi('/schedule');
    const { data: playersResp } = useApi('/players');
    const { data: lbResp, loading: lbLoading, refetch: refetchLb } = useApi('/predictions/leaderboard');

    // --- Form state ---
    const [selectedMatchId, setSelectedMatchId] = useState('');
    const [homeScore, setHomeScore] = useState('');
    const [awayScore, setAwayScore] = useState('');
    const [homeRows, setHomeRows] = useState([]);
    const [awayRows, setAwayRows] = useState([]);

    // --- Lockout State ---
    const [hasPredicted, setHasPredicted] = useState(false);
    const [checkingStatus, setCheckingStatus] = useState(false);

    // --- Submission state ---
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [submitError, setSubmitError] = useState(null);
    
    // --- Upstream Feature: Prediction History Tabs ---
    const [activeTab, setActiveTab] = useState('leaderboard'); // 'leaderboard', 'pending', 'history'
    const [predictions, setPredictions] = useState([]);
    const [predLoading, setPredLoading] = useState(true);
    const [showAll, setShowAll] = useState(false);

    // Fetch History
    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return;
                const API_URL = import.meta.env.VITE_API_URL || '/api';
                const res = await fetch(`${API_URL}/predictions/history`, {
                    headers: { 'Authorization': `Bearer ${session.access_token}` }
                });
                const result = await res.json();
                if (result.success) setPredictions(result.data || []);
            } catch (err) {
                console.error('Failed to fetch prediction history', err);
            } finally {
                setPredLoading(false);
            }
        };
        if (user && (activeTab === 'history' || activeTab === 'pending')) fetchHistory();
    }, [user, activeTab]);

    const pendingPredictions = predictions.filter(p => p.status === 'pending');
    const gradedPredictions = predictions.filter(p => p.status === 'graded');
    const totalPredPoints = gradedPredictions.reduce((sum, p) => sum + (p.points_awarded || 0), 0);
    
    // Filter displayed list based on active tab
    const filteredPredictions = useMemo(() => {
        if (activeTab === 'pending') return pendingPredictions;
        if (activeTab === 'history') return gradedPredictions;
        return [];
    }, [activeTab, predictions]);

    const displayedPredictions = showAll ? filteredPredictions : filteredPredictions.slice(0, 5);

    // REDIRECT TO ONBOARDING IF MISSING NEW DUAL FLAIRS
    useEffect(() => {
        if (user && profile) {
            if (!profile.mens_team_flair || !profile.womens_team_flair) {
                // Safely update the view state without reloading the page!
                // NOTE: If this still causes issues, delete this useEffect entirely 
                // and rely on the UI block we are adding below!
            }
        }
    }, [user, profile]);

    // Reset form when division changes
    useEffect(() => {
        setSelectedMatchId('');
        setHomeScore('');
        setAwayScore('');
        setHomeRows([]);
        setAwayRows([]);
        setSubmitted(false);
        setSubmitError(null);
        setHasPredicted(false);
    }, [division]);

    // Include date and status for kickoff validation
    const upcomingMatches = useMemo(() =>
        (scheduleResp?.data || []).map(m => ({
            id: m.id,
            homeTeam: m.home_team || 'Team A',
            awayTeam: m.away_team || 'Team B',
            home_team_id: m.home_team_id,
            away_team_id: m.away_team_id,
            date: m.date,
            status: m.status
        })),
        [scheduleResp]);

    const allPlayers = playersResp?.data || [];
    const selectedMatch = upcomingMatches.find(m => m.id === selectedMatchId);

    // Check if the match has already kicked off
    const isMatchStarted = useMemo(() => {
        if (!selectedMatch) return false;

        // Fallback 1: Check backend status
        if (selectedMatch.status === 'live' || selectedMatch.status === 'completed') return true;

        // Fallback 2: Check the actual timestamp
        if (selectedMatch.date) {
            const kickoffTime = new Date(selectedMatch.date).getTime();
            const currentTime = new Date().getTime();
            return currentTime >= kickoffTime;
        }

        return false;
    }, [selectedMatch]);

    // Check if they already predicted when they select a match
    useEffect(() => {
        const checkPredictionStatus = async () => {
            if (!selectedMatchId) return;
            setCheckingStatus(true);
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const API_URL = import.meta.env.VITE_API_URL || '/api';

                const res = await fetch(`${API_URL}/predictions/${selectedMatchId}`, {
                    headers: { 'Authorization': `Bearer ${session?.access_token}` }
                });
                const result = await res.json();

                if (result.success) {
                    setHasPredicted(result.has_predicted);
                }
            } catch (err) {
                console.error("Failed to check prediction status", err);
            } finally {
                setCheckingStatus(false);
            }
        };
        checkPredictionStatus();
    }, [selectedMatchId]);

    const matchPlayers = useMemo(() => {
        if (!selectedMatch) return allPlayers;
        return allPlayers.filter(p =>
            p.team_id === selectedMatch.home_team_id ||
            p.team_id === selectedMatch.away_team_id
        );
    }, [selectedMatch, allPlayers]);

    useEffect(() => {
        const hs = parseInt(homeScore) || 0;
        setHomeRows(prev => {
            if (hs === prev.length) return prev;
            if (hs > prev.length) return [...prev, ...Array.from({ length: hs - prev.length }, () => ({ scorer: '', assist: '' }))];
            return prev.slice(0, hs);
        });
    }, [homeScore]);

    useEffect(() => {
        const as = parseInt(awayScore) || 0;
        setAwayRows(prev => {
            if (as === prev.length) return prev;
            if (as > prev.length) return [...prev, ...Array.from({ length: as - prev.length }, () => ({ scorer: '', assist: '' }))];
            return prev.slice(0, as);
        });
    }, [awayScore]);

    const handleUpdateRow = (team, index, field, value) => {
        const setter = team === 'home' ? setHomeRows : setAwayRows;
        setter(prev => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };

            if (field === 'scorer' && next[index].assist === value) {
                next[index].assist = '';
            }
            return next;
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedMatch || homeScore === '' || awayScore === '') return;
        if (isMatchStarted) return; // Extra safety block

        setSubmitting(true);
        setSubmitError(null);

        const predicted_scorers = [...homeRows, ...awayRows]
            .map(r => r.scorer)
            .filter(Boolean);

        const predicted_assists = [...homeRows, ...awayRows]
            .map(r => r.assist)
            .filter(s => s && s !== 'Unassisted');

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const API_URL = import.meta.env.VITE_API_URL || '/api';

            const res = await fetch(`${API_URL}/predictions/${selectedMatchId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    predicted_home_score: parseInt(homeScore) || 0,
                    predicted_away_score: parseInt(awayScore) || 0,
                    predicted_scorers,
                    predicted_assists,
                }),
            });

            const result = await res.json();

            if (!res.ok || !result.success) {
                throw new Error(result.message || 'Failed to submit prediction');
            }

            setSubmitted(true);
            refetchLb();
        } catch (err) {
            console.error("Submission Error:", err);
            setSubmitError(err.message || 'Failed to submit prediction. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleReset = () => {
        setSubmitted(false);
        setSelectedMatchId('');
        setHomeScore('');
        setAwayScore('');
        setHomeRows([]);
        setAwayRows([]);
        setSubmitError(null);
        setHasPredicted(false);
    };

    const leaderboard = lbResp?.data?.overall || [];
    const myEntry = leaderboard.find(entry => entry.user_id === user?.id);
    const myPoints = myEntry ? myEntry.total_points : 0;
    const myName = profile?.nickname || user?.user_metadata?.full_name || user?.user_metadata?.name || 'Player';
    
    // Determine which flair to show for the current user based on the active division
    const myActiveFlair = division === 'mens' ? profile?.mens_team_flair : profile?.womens_team_flair;

    if (scheduleLoading) {
        return <Loader text="Loading Predictor Engine..." />;
    }

    if (!user) {
        return <div className="animate-in fade-in zoom-in-95 duration-500"><Login /></div>;
    }

    // --- NEW: THE FRIENDLY PROFILE BLOCKER ---
    if (!profile?.mens_team_flair || !profile?.womens_team_flair) {
        return (
            <div className="max-w-xl mx-auto mt-20 p-8 bg-black/40 border border-white/10 rounded-3xl text-center backdrop-blur-md animate-in fade-in zoom-in-95 duration-500">
                <Target className="w-12 h-12 text-zinc-500 mx-auto mb-6" />
                <h2 className="text-2xl font-black uppercase tracking-widest text-white mb-2">Profile Update Required</h2>
                <p className="text-zinc-400 mb-8">
                    To access the Fantasy League, you must select your team allegiances for both the Men's and Women's divisions.
                </p>
                {/* Notice we just change the state, no window.location.href! */}
                <button 
                    onClick={() => {
                        // Assuming you have access to setView via useLeague context:
                        // If you don't have setView in this file, you might need to import it!
                        window.location.href = '/?view=profile'; // Send them to the User Profile page!
                    }}
                    className="w-full h-14 bg-white text-black hover:bg-zinc-200 rounded-xl font-bold uppercase tracking-widest transition-all duration-300"
                >
                    Update Profile
                </button>
            </div>
        );
    }

    return (
        <div className="w-full mx-auto space-y-8 animate-in fade-in duration-500 pb-12">

            {/* Sub-tab navigation moved to TopNavbar */}

            {fantasySection === 'season1' ? (
                <>
                    {/* S1/FIFA Toggle on the page itself */}
                    <div className="flex justify-center mb-6">
                        <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/10 relative z-10">
                            <button
                                onClick={() => setFantasySection('season1')}
                                className={cn(
                                    "px-4 py-2 sm:px-6 sm:py-2.5 rounded-full text-xs sm:text-sm font-bold uppercase tracking-widest transition-colors duration-300",
                                    fantasySection === 'season1' ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                                )}
                            >
                                Season 1
                            </button>
                            <button
                                onClick={() => setFantasySection('fifa')}
                                className={cn(
                                    "px-4 py-2 sm:px-6 sm:py-2.5 rounded-full text-xs sm:text-sm font-bold uppercase tracking-widest transition-colors duration-300",
                                    fantasySection === 'fifa' ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                                )}
                            >
                                FIFA
                            </button>
                        </div>
                    </div>

            {/* Header */}
            <div className="text-center space-y-4 mb-8">
                <h1 className="text-4xl sm:text-6xl font-black tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">
                    Fantasy Super League
                </h1>
                <p className="text-zinc-400 max-w-xl mx-auto text-lg">
                    Predict match outcomes to climb the global leaderboard.
                </p>

                {/* User Stats Banner */}
                {user && !lbLoading && (
                    <div className="bg-white/10 border border-white/20 rounded-2xl p-4 sm:p-6 flex items-center justify-between max-w-2xl mx-auto mt-6 shadow-xl backdrop-blur-md transition-all hover:bg-white/15">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white text-black flex items-center justify-center font-black text-2xl flex-shrink-0">
                                {myName.charAt(0).toUpperCase()}
                            </div>
                            <div className="text-left">
                                <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest leading-none mb-1.5 pt-1">Player</p>
                                <div className="flex flex-col items-start gap-1">
                                    <p className="text-xl sm:text-2xl font-black text-white leading-none">{myName}</p>
                                    {myActiveFlair && (
                                        <span className={cn("px-2 py-[2px] rounded-full text-[10px] text-white font-bold leading-none tracking-wide shadow-sm border border-white/10", getTeamColorClass(myActiveFlair))}>
                                            {myActiveFlair}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="text-right flex flex-col items-end justify-center">
                            <div className="text-3xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400 leading-none mb-1.5 pt-1">
                                {myPoints.toLocaleString()}
                            </div>
                            <p className="text-[10px] sm:text-xs font-bold text-zinc-400 uppercase tracking-widest leading-none">
                                PTS
                            </p>
                        </div>
                    </div>
                )}

                {/* Scoring rules */}
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 text-left mx-auto max-w-2xl mt-4">
                    <h3 className="text-lg font-black uppercase tracking-widest text-white mb-4 border-b border-white/10 pb-2">How Scoring Works</h3>
                    <div className="space-y-4 text-sm font-medium text-zinc-300">
                        <div>
                            <p className="text-white font-bold text-base mb-1">Match Result & Scoreline</p>
                            <ul className="list-disc list-inside space-y-1 ml-2 text-zinc-400">
                                <li><span className="text-white font-bold">300 Points</span> — exact final score</li>
                                <li><span className="text-white font-bold">100 Points</span> — correct result (win/draw/loss)</li>
                                <li><span className="text-red-400 font-bold">-10 Points</span> — penalty per incorrect goal difference</li>
                            </ul>
                        </div>
                        <div>
                            <p className="text-white font-bold text-base mb-1">Goalscorers & Assists</p>
                            <ul className="list-disc list-inside space-y-1 ml-2 text-zinc-400">
                                <li><span className="text-white font-bold">100 Points</span> per correct goalscorer</li>
                                <li><span className="text-white font-bold">50 Points</span> per correct assist</li>
                            </ul>
                            <div className="mt-3 bg-black/40 p-4 rounded-xl border border-white/5 text-xs text-zinc-400 leading-relaxed relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-yellow-500"></div>
                                <span className="text-white font-black uppercase tracking-wider block mb-1">Frequency Strategy</span>
                                You can pick the same player multiple times. The system counts totals, not order.
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Prediction Form */}
            {!submitted ? (
                <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-10 backdrop-blur-md">

                    {/* Step 1: Match */}
                    <div className="mb-10">
                        <h3 className="text-xl font-bold uppercase tracking-widest mb-4 text-white">1. Select Match</h3>
                        {upcomingMatches.length === 0 ? (
                            <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm py-4">No upcoming matches scheduled.</p>
                        ) : (
                            <select
                                value={selectedMatchId}
                                onChange={(e) => setSelectedMatchId(e.target.value)}
                                className="w-full h-16 bg-black/60 border border-white/10 rounded-xl px-6 text-lg font-bold text-white appearance-none focus:outline-none focus:border-white/30 transition-colors cursor-pointer"
                                required
                            >
                                <option value="" disabled>Choose an upcoming match...</option>
                                {upcomingMatches.map(m => (
                                    <option key={m.id} value={m.id} className="bg-zinc-900">
                                        {m.homeTeam} vs {m.awayTeam}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    {selectedMatch && (
                        <div className="animate-in fade-in zoom-in-95 duration-300 space-y-10">
                            <hr className="border-white/5" />

                            {/* CHECK IF MATCH ALREADY STARTED OR ALREADY PREDICTED */}
                            {checkingStatus ? (
                                <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-zinc-500" /></div>
                            ) : isMatchStarted ? (
                                <div className="text-center py-12 bg-black/40 rounded-2xl border border-white/5 animate-in zoom-in-95 duration-500">
                                    <Lock className="w-12 h-12 text-red-500/80 mx-auto mb-4" />
                                    <h3 className="text-xl font-black uppercase tracking-widest text-white mb-2">Match Started</h3>
                                    <p className="text-zinc-400 text-sm max-w-md mx-auto">
                                        Kickoff has already happened! Predictions for this match are now locked. Good luck to those who got them in!
                                    </p>
                                </div>
                            ) : hasPredicted ? (
                                <div className="text-center py-12 bg-black/40 rounded-2xl border border-white/5 animate-in zoom-in-95 duration-500">
                                    <Lock className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
                                    <h3 className="text-xl font-black uppercase tracking-widest text-white mb-2">Prediction Locked</h3>
                                    <p className="text-zinc-400 text-sm max-w-md mx-auto">
                                        You have already submitted your predictions for this match. Good luck! Points will be awarded after the final whistle.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {/* Step 2: Score */}
                                    <div>
                                        <h3 className="text-xl font-bold uppercase tracking-widest mb-6 text-white">2. Predict Score</h3>
                                        <div className="flex items-center justify-center gap-4 sm:gap-8 bg-black/30 p-6 rounded-2xl border border-white/5">
                                            <div className="text-right flex-1">
                                                <p className="text-sm sm:text-xl font-black uppercase text-zinc-300 mb-4 truncate">{selectedMatch.homeTeam}</p>
                                                <input
                                                    type="number" min="0" max="20"
                                                    value={homeScore}
                                                    onChange={(e) => setHomeScore(e.target.value)}
                                                    className="w-16 sm:w-24 h-16 sm:h-24 text-4xl sm:text-5xl text-center font-black bg-black/70 border border-white/10 rounded-2xl focus:outline-none focus:border-white/30 transition-all text-white"
                                                    placeholder="0" required
                                                />
                                            </div>
                                            <div className="text-lg sm:text-2xl font-black text-zinc-600 mt-10">VS</div>
                                            <div className="text-left flex-1">
                                                <p className="text-sm sm:text-xl font-black uppercase text-zinc-300 mb-4 truncate">{selectedMatch.awayTeam}</p>
                                                <input
                                                    type="number" min="0" max="20"
                                                    value={awayScore}
                                                    onChange={(e) => setAwayScore(e.target.value)}
                                                    className="w-16 sm:w-24 h-16 sm:h-24 text-4xl sm:text-5xl text-center font-black bg-black/70 border border-white/10 rounded-2xl focus:outline-none focus:border-white/30 transition-all text-white"
                                                    placeholder="0" required
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Step 3: Goal events */}
                                    {(homeRows.length > 0 || awayRows.length > 0) && (
                                        <div className="space-y-8 animate-in fade-in slide-in-from-top-4 duration-300">
                                            <h3 className="text-xl font-bold uppercase tracking-widest text-white">3. Select Match Events</h3>

                                            {[
                                                { rows: homeRows, team: 'home', label: selectedMatch.homeTeam, teamId: selectedMatch.home_team_id },
                                                { rows: awayRows, team: 'away', label: selectedMatch.awayTeam, teamId: selectedMatch.away_team_id },
                                            ].map(({ rows, team, label, teamId }) => {

                                                const teamPlayers = matchPlayers.filter(p => (p.team_id || p.teams?.id) === teamId);

                                                return rows.length > 0 && (
                                                    <div key={team} className="space-y-4">
                                                        <h4 className="font-bold text-zinc-400 flex items-center gap-2 bg-white/5 p-3 rounded-xl">
                                                            <span className={`w-2 h-2 rounded-full ${team === 'home' ? 'bg-white' : 'bg-zinc-500'}`}></span>
                                                            {label} Goals ({rows.length})
                                                        </h4>
                                                        <div className="space-y-3">
                                                            {rows.map((row, i) => {
                                                                const assistOptions = teamPlayers.filter(p => p.id !== row.scorer);

                                                                return (
                                                                    <div key={`${team}-${i}`} className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-black/40 p-4 rounded-xl border border-white/5">
                                                                        <select
                                                                            value={row.scorer}
                                                                            onChange={(e) => handleUpdateRow(team, i, 'scorer', e.target.value)}
                                                                            className="w-full h-12 bg-black/60 border border-white/10 rounded-lg px-4 text-sm font-bold text-white focus:outline-none focus:border-white/30 transition-colors"
                                                                            required
                                                                        >
                                                                            <option value="" disabled>Select Goalscorer...</option>
                                                                            {teamPlayers.map(p => (
                                                                                <option key={p.id} value={p.id} className="bg-zinc-900">
                                                                                    {p.name || `${p.first_name} ${p.last_name}`}{p.position ? ` (${p.position})` : ''}
                                                                                </option>
                                                                            ))}
                                                                        </select>

                                                                        <select
                                                                            value={row.assist}
                                                                            onChange={(e) => handleUpdateRow(team, i, 'assist', e.target.value)}
                                                                            className="w-full h-12 bg-black/60 border border-white/10 rounded-lg px-4 text-sm font-bold text-white focus:outline-none focus:border-white/30 transition-colors"
                                                                            required
                                                                        >
                                                                            <option value="" disabled>Select Assist...</option>
                                                                            <option value="Unassisted" className="bg-zinc-900 text-zinc-400">Unassisted</option>
                                                                            {assistOptions.map(p => (
                                                                                <option key={`a-${p.id}`} value={p.id} className="bg-zinc-900">
                                                                                    {p.name || `${p.first_name} ${p.last_name}`}{p.position ? ` (${p.position})` : ''}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {submitError && (
                                        <p className="text-red-400 font-bold text-sm text-center">{submitError}</p>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="w-full group h-16 bg-white text-black hover:bg-zinc-200 rounded-xl font-bold text-lg uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-3 disabled:opacity-50"
                                    >
                                        {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                                            <><span>Lock In Prediction</span><Send className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></>
                                        )}
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </form>
            ) : (
                /* Success state */
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-10 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-white/30 via-white to-white/30"></div>
                    <CheckCircle2 className="w-16 h-16 text-white mx-auto mb-4" />
                    <h3 className="text-3xl font-black uppercase tracking-tighter text-white mb-2">Prediction Locked!</h3>
                    <p className="text-zinc-400 mb-8 max-w-lg mx-auto">
                        Your prediction has been saved. Points will be awarded once the match is completed and graded.
                    </p>
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 mx-auto px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-bold uppercase tracking-widest rounded-full transition-all text-sm"
                    >
                        <RefreshCw className="w-4 h-4" /> Predict Another Match
                    </button>
                </div>
            )}

            <div id="stats-section" className="bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-10 backdrop-blur-md">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-8">
                    <div className="flex items-center gap-2 bg-black/40 p-1.5 rounded-2xl border border-white/5 w-full sm:w-auto overflow-x-auto no-scrollbar">
                        <button
                            onClick={() => setActiveTab('leaderboard')}
                            className={cn(
                                "px-4 sm:px-6 py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap",
                                activeTab === 'leaderboard' 
                                    ? "bg-white text-black shadow-lg" 
                                    : "text-zinc-500 hover:text-white"
                            )}
                        >
                            Leaderboard
                        </button>
                        <button
                            onClick={() => setActiveTab('pending')}
                            className={cn(
                                "px-4 sm:px-6 py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap",
                                activeTab === 'pending' 
                                    ? "bg-white text-black shadow-lg" 
                                    : "text-zinc-500 hover:text-white"
                            )}
                        >
                            Pending
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={cn(
                                "px-4 sm:px-6 py-2.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap",
                                activeTab === 'history' 
                                    ? "bg-white text-black shadow-lg" 
                                    : "text-zinc-500 hover:text-white"
                            )}
                        >
                            History
                        </button>
                    </div>

                    <div className="hidden sm:flex items-center gap-2">
                        {/* Headers removed as requested */}
                    </div>
                </div>

                {activeTab === 'leaderboard' ? (
                    <>
                        {lbLoading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
                            </div>
                        ) : leaderboard.length === 0 ? (
                            <p className="text-center text-zinc-600 font-bold uppercase tracking-widest text-sm py-8">
                                No predictions graded yet. Be the first!
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {leaderboard.map((entry, index) => {
                                    const isMe = entry.user_id === user?.id;
                                    return (
                                        <div
                                            key={entry.user_id}
                                            className={cn(
                                                "flex items-center justify-between p-4 sm:p-5 border rounded-2xl transition-all",
                                                isMe
                                                    ? "bg-white/10 border-white/40"
                                                    : index === 0
                                                        ? "bg-white/5 border-white/20"
                                                        : "bg-black/40 border-white/5 hover:bg-white/5"
                                            )}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={cn(
                                                    "w-10 h-10 flex items-center justify-center rounded-full font-black text-lg",
                                                    isMe ? "bg-white text-black" : index === 0 ? "bg-white text-black" : "bg-white/5 text-zinc-400"
                                                )}>
                                                    {index + 1}
                                                </div>
                                                <span className="font-bold text-white text-lg flex flex-col items-start leading-tight">
                                                    <div className="flex items-center">
                                                        {isMe ? myName : entry.username}
                                                        {isMe && <span className="ml-2 text-[10px] bg-white text-black px-2 py-0.5 rounded-full uppercase tracking-widest font-black">You</span>}
                                                    </div>
                                                    
                                                    {/* DYNAMIC FLAIR BASED ON DIVISION */}
                                                    {(() => {
                                                        const activeLbFlair = division === 'mens' ? entry.mens_team_flair : entry.womens_team_flair;
                                                        if (!activeLbFlair) return null;
                                                        return (
                                                            <span className={cn("px-2 py-[2px] mt-1 rounded-full text-[10px] text-white font-bold leading-none tracking-wide shadow-sm border border-white/10", getTeamColorClass(activeLbFlair))}>
                                                                {activeLbFlair}
                                                            </span>
                                                        );
                                                    })()}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-2xl sm:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400">
                                                    {entry.total_points.toLocaleString()}
                                                </span>
                                                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest block">PTS</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        <div className="space-y-6">
                            {/* Summary Stats (Only on History tab) */}
                            {activeTab === 'history' && !predLoading && gradedPredictions.length > 0 && (
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                                        <p className="text-2xl font-black text-white">{predictions.length}</p>
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Total</p>
                                    </div>
                                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                                        <p className="text-2xl font-black text-green-400">{gradedPredictions.length}</p>
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Graded</p>
                                    </div>
                                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                                        <p className={`text-2xl font-black ${totalPredPoints >= 0 ? 'text-white' : 'text-red-400'}`}>{totalPredPoints}</p>
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Points</p>
                                    </div>
                                </div>
                            )}

                            {/* Prediction Cards */}
                            {predLoading ? (
                                <div className="text-center py-12">
                                    <Loader2 className="w-8 h-8 animate-spin text-zinc-600 mx-auto mb-4" />
                                    <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">Fetching your record...</p>
                                </div>
                            ) : filteredPredictions.length === 0 ? (
                                <div className="text-center py-16 border border-dashed border-white/10 rounded-3xl bg-black/20">
                                    <Target size={40} className="text-zinc-800 mx-auto mb-4 opacity-50" />
                                    <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest">No predictions yet</p>
                                    <p className="text-zinc-600 text-[11px] mt-2 max-w-[200px] mx-auto uppercase tracking-tighter leading-tight font-medium">Use the form above to lock in your first score!</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {displayedPredictions.map((pred) => {
                                        const match = pred.matches;
                                        if (!match) return null;

                                        const isGraded = pred.status === 'graded';
                                        const pts = pred.points_awarded || 0;
                                        const isPositive = pts > 0;
                                        const isExact = isGraded && pred.predicted_home_score === match.home_score && pred.predicted_away_score === match.away_score;

                                        return (
                                            <div key={pred.id} className={cn(
                                                "bg-black/40 border rounded-2xl p-5 sm:p-6 transition-all hover:bg-white/5",
                                                isExact ? "border-yellow-500/30 ring-1 ring-yellow-500/10" : "border-white/5"
                                            )}>
                                                {/* Match header */}
                                                <div className="flex items-center justify-between mb-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            "p-2 rounded-lg",
                                                            isGraded 
                                                                ? (isPositive ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500') 
                                                                : 'bg-white/5 text-zinc-500'
                                                        )}>
                                                            {isGraded ? <CheckCircle2 size={16} /> : <Clock size={16} />}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 leading-none mb-1">
                                                                {new Date(match.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                                            </span>
                                                            {isExact && (
                                                                <span className="text-[9px] text-yellow-500 font-black uppercase tracking-widest">Perfect Score!</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {isGraded ? (
                                                        <div className="text-right">
                                                            <p className={cn(
                                                                "text-xl font-black tabular-nums leading-none",
                                                                isPositive ? "text-green-400" : pts === 0 ? "text-zinc-500" : "text-red-400"
                                                            )}>
                                                                {isPositive ? '+' : ''}{pts}
                                                            </p>
                                                            <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mt-1">Points</p>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest bg-white/5 px-3 py-1.5 rounded-full border border-white/5">Pending</span>
                                                    )}
                                                </div>

                                                {/* Score comparison */}
                                                <div className="flex items-center gap-4 py-4 border-y border-white/5">
                                                    <div className="flex-1 text-right min-w-0">
                                                        <p className="text-xs sm:text-sm font-black text-white truncate uppercase tracking-tight">{match.home_team_name}</p>
                                                    </div>

                                                    <div className="flex items-center gap-3 px-4">
                                                        <div className="flex flex-col items-center">
                                                            <div className="flex items-center gap-1.5 bg-black/60 border border-white/10 rounded-xl px-4 py-2 mt-1">
                                                                <span className="text-xl font-black text-white tabular-nums">{pred.predicted_home_score}</span>
                                                                <span className="text-xs text-zinc-600 font-black">-</span>
                                                                <span className="text-xl font-black text-white tabular-nums">{pred.predicted_away_score}</span>
                                                            </div>
                                                            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mt-2">Prediction</p>
                                                        </div>

                                                        <div className="h-8 w-px bg-white/5"></div>

                                                        <div className="flex flex-col items-center">
                                                            <div className={cn(
                                                                "flex items-center gap-1.5 rounded-xl px-4 py-2 mt-1 border",
                                                                isGraded ? "bg-white/5 border-white/10" : "bg-transparent border-dashed border-white/10"
                                                            )}>
                                                                {isGraded ? (
                                                                    <>
                                                                        <span className="text-xl font-black text-zinc-500 tabular-nums">{match.home_score}</span>
                                                                        <span className="text-xs text-zinc-700 font-black">-</span>
                                                                        <span className="text-xl font-black text-zinc-500 tabular-nums">{match.away_score}</span>
                                                                    </>
                                                                ) : (
                                                                    <span className="text-xs text-zinc-700 font-bold px-3 py-1">TBD</span>
                                                                )}
                                                            </div>
                                                            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mt-2">Final Result</p>
                                                        </div>
                                                    </div>

                                                    <div className="flex-1 text-left min-w-0">
                                                        <p className="text-xs sm:text-sm font-black text-white truncate uppercase tracking-tight">{match.away_team_name}</p>
                                                    </div>
                                                </div>

                                                {/* Points Breakdown */}
                                                {isGraded && pred.breakdown && pred.breakdown.length > 0 && (
                                                    <div className="mt-5 space-y-2">
                                                        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-3">Event Breakdown</p>
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                            {pred.breakdown.map((item, i) => (
                                                                <div key={i} className="flex items-center justify-between gap-3 bg-black/20 p-2.5 rounded-xl border border-white/5">
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-2">
                                                                            <p className={cn(
                                                                                "text-[10px] font-black uppercase tracking-tight",
                                                                                item.points > 0 ? "text-green-400" : item.points < 0 ? "text-red-400" : "text-zinc-600"
                                                                            )}>
                                                                                {item.label}
                                                                            </p>
                                                                            <span className={cn(
                                                                                "text-[10px] font-black tabular-nums",
                                                                                item.points > 0 ? "text-green-500/80" : item.points < 0 ? "text-red-500/80" : "text-zinc-700"
                                                                            )}>
                                                                                ({item.points > 0 ? '+' : ''}{item.points})
                                                                            </span>
                                                                        </div>
                                                                        <p className="text-[9px] font-bold text-zinc-600 truncate mt-0.5">{item.detail}</p>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {/* Show More / Less */}
                                    {filteredPredictions.length > 5 && (
                                        <button
                                            onClick={() => setShowAll(!showAll)}
                                            className="w-full flex items-center justify-center gap-2 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white hover:bg-white/5 rounded-2xl transition-all border border-dashed border-white/5 mt-4"
                                        >
                                            {showAll ? <><ChevronUp size={14} /> Collapse List</> : <><ChevronDown size={14} /> View All {filteredPredictions.length} {activeTab === 'pending' ? 'Pending' : 'Graded'} Predictions</>}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
            </>
            ) : (
                <FifaPrediction />
            )}
    </div>
  );
}