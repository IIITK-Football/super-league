import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { scopeQuery, useLeague } from '../context/LeagueContext';
import { useAuth } from '../context/AuthContext';
import { FifaPrediction } from './FifaPrediction';
import { useApi } from '../hooks/useApi';
import { API_BASE_URL } from '../lib/api';
import { Login } from './Login';
import { Onboarding } from './Onboarding';
import { supabase } from '../lib/supabase';
import { Button, EmptyState, ErrorState, Field, Notice, Pill, Skeleton, Tabs } from '../components/ui';

const PILL = 'inline-flex min-h-11 w-full items-center justify-center rounded-pill bg-ink px-6 text-sm font-black uppercase tracking-[0.2em] text-bg transition hover:opacity-85 disabled:pointer-events-none disabled:opacity-40';

// A match has kicked off when its status says so or its kickoff time has passed. Such matches take no predictions.
const kickedOff = (m) => m.status === 'live' || m.status === 'completed' || (m.date && new Date(m.date).getTime() <= Date.now());
const playerName = (p) => p.name || `${p.first_name} ${p.last_name}`;

export function Fantasy() {
    const { seasonScope, fantasySection, setFantasySection } = useLeague();
    const { user, profile } = useAuth();
    const { pathname } = useLocation();

    // /fantasy is the league predictions page. The World Cup predictor is reached at /wc, which sets its own section.
    // The layout effect runs before paint, so the wrong section never shows.
    useLayoutEffect(() => {
        if (pathname === '/fantasy') setFantasySection('season1');
    }, [pathname, setFantasySection]);

    const { data: scheduleResp, loading: scheduleLoading } = useApi('/schedule');
    const { data: playersResp } = useApi('/players');
    const { data: lbResp, loading: lbLoading, error: lbError, refetch: refetchLb } = useApi('/predictions/leaderboard');

    // --- Form state ---
    const [selectedMatchId, setSelectedMatchId] = useState('');
    const [homeScore, setHomeScore] = useState('');
    const [awayScore, setAwayScore] = useState('');
    const [homeRows, setHomeRows] = useState([]);
    const [awayRows, setAwayRows] = useState([]);
    const [hasPredicted, setHasPredicted] = useState(false);
    const [checkingStatus, setCheckingStatus] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [submitError, setSubmitError] = useState(null);

    // --- Prediction history ---
    const [activeTab, setActiveTab] = useState('leaderboard'); // 'leaderboard' | 'pending' | 'history'
    const [predictions, setPredictions] = useState([]);
    const [predLoading, setPredLoading] = useState(false);
    const [predError, setPredError] = useState(false);
    const [historyAttempt, setHistoryAttempt] = useState(0);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        if (!user || !seasonScope.ready || (activeTab !== 'history' && activeTab !== 'pending')) return undefined;
        let cancelled = false;
        setPredLoading(true);
        setPredError(false);
        (async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const res = await fetch(`${API_BASE_URL}/predictions/history?${scopeQuery(seasonScope)}`, {
                    headers: { Authorization: `Bearer ${session?.access_token}` },
                });
                const result = await res.json();
                if (!res.ok || !result.success) throw new Error(result.error || 'history');
                if (!cancelled) setPredictions(result.data || []);
            } catch (err) {
                console.error('Failed to fetch prediction history', err);
                if (!cancelled) setPredError(true);
            } finally {
                if (!cancelled) setPredLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, activeTab, seasonScope.ready, seasonScope.division, seasonScope.season?.slug, historyAttempt]);

    const pendingPredictions = predictions.filter((p) => p.status === 'pending');
    const gradedPredictions = predictions.filter((p) => p.status === 'graded');
    const filteredPredictions = activeTab === 'pending' ? pendingPredictions : activeTab === 'history' ? gradedPredictions : [];
    const displayedPredictions = showAll ? filteredPredictions : filteredPredictions.slice(0, 5);

    // The signed-in user's club for the selected division (division_flairs).
    const [myActiveFlair, setMyActiveFlair] = useState(null);
    useEffect(() => {
        const divisionId = seasonScope.divisionRecord?.id;
        if (!user || !divisionId) { setMyActiveFlair(null); return; }
        let cancelled = false;
        supabase.from('division_flairs').select('team_name').eq('user_id', user.id).eq('division_id', divisionId).maybeSingle()
            .then(({ data }) => { if (!cancelled) setMyActiveFlair(data?.team_name || null); });
        return () => { cancelled = true; };
    }, [user, seasonScope.divisionRecord?.id]);

    const upcomingMatches = useMemo(() =>
        (scheduleResp?.data || []).filter((m) => !kickedOff(m)).map((m) => ({
            id: m.id,
            homeTeam: m.home_team || 'Team A',
            awayTeam: m.away_team || 'Team B',
            home_team_id: m.home_team_id,
            away_team_id: m.away_team_id,
        })),
        [scheduleResp]);

    const allPlayers = useMemo(() => playersResp?.data || [], [playersResp]);
    const selectedMatch = upcomingMatches.find((m) => m.id === selectedMatchId);

    // Choosing a match starts a clean form. Answers for the match chosen before are ignored (see the effect below).
    const selectMatch = (id) => {
        setSelectedMatchId(id);
        setHomeScore('');
        setAwayScore('');
        setHomeRows([]);
        setAwayRows([]);
        setSubmitted(false);
        setSubmitError(null);
        setHasPredicted(false);
    };

    useEffect(() => {
        if (!selectedMatchId) return undefined;
        let cancelled = false;
        setCheckingStatus(true);
        (async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const res = await fetch(`${API_BASE_URL}/predictions/${selectedMatchId}`, {
                    headers: { Authorization: `Bearer ${session?.access_token}` },
                });
                const result = await res.json();
                if (!cancelled && result.success) setHasPredicted(Boolean(result.has_predicted));
            } catch (err) {
                console.error('Failed to check prediction status', err);
            } finally {
                if (!cancelled) setCheckingStatus(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedMatchId]);

    const matchPlayers = useMemo(() => {
        if (!selectedMatch) return allPlayers;
        return allPlayers.filter((p) => p.team_id === selectedMatch.home_team_id || p.team_id === selectedMatch.away_team_id);
    }, [selectedMatch, allPlayers]);

    useEffect(() => {
        const hs = parseInt(homeScore, 10) || 0;
        setHomeRows((prev) => {
            if (hs === prev.length) return prev;
            if (hs > prev.length) return [...prev, ...Array.from({ length: hs - prev.length }, () => ({ scorer: '', assist: '' }))];
            return prev.slice(0, hs);
        });
    }, [homeScore]);

    useEffect(() => {
        const as = parseInt(awayScore, 10) || 0;
        setAwayRows((prev) => {
            if (as === prev.length) return prev;
            if (as > prev.length) return [...prev, ...Array.from({ length: as - prev.length }, () => ({ scorer: '', assist: '' }))];
            return prev.slice(0, as);
        });
    }, [awayScore]);

    const handleUpdateRow = (team, index, field, value) => {
        const setter = team === 'home' ? setHomeRows : setAwayRows;
        setter((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            if (field === 'scorer' && next[index].assist === value) next[index].assist = '';
            return next;
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedMatch || homeScore === '' || awayScore === '' || kickedOff(selectedMatch)) return;

        setSubmitting(true);
        setSubmitError(null);
        const predicted_scorers = [...homeRows, ...awayRows].map((r) => r.scorer).filter(Boolean);
        const predicted_assists = [...homeRows, ...awayRows].map((r) => r.assist).filter((s) => s && s !== 'Unassisted');

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch(`${API_BASE_URL}/predictions/${selectedMatchId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
                body: JSON.stringify({
                    predicted_home_score: parseInt(homeScore, 10) || 0,
                    predicted_away_score: parseInt(awayScore, 10) || 0,
                    predicted_scorers,
                    predicted_assists,
                }),
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) throw new Error(result.message || 'Your prediction was not saved. Try again.');
            setSubmitted(true);
            refetchLb();
        } catch (err) {
            console.error('Submission Error:', err);
            setSubmitError(err.message || 'Your prediction was not saved. Try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const leaderboard = lbResp?.data?.overall || [];
    const myEntry = leaderboard.find((entry) => entry.user_id === user?.id);
    const myRank = myEntry ? leaderboard.indexOf(myEntry) + 1 : null;
    const myName = profile?.nickname || user?.user_metadata?.full_name || user?.user_metadata?.name || 'Player';

    if (!user && fantasySection !== 'fifa') {
        return <Login />;
    }
    // The World Cup predictor needs its own champion pick.
    if (user && !profile?.wc_team_flair && fantasySection === 'fifa') {
        return <Onboarding requireWorldCup />;
    }
    if (fantasySection !== 'season1') {
        return <FifaPrediction />;
    }

    const teamPlayers = (teamId) => matchPlayers.filter((p) => (p.team_id || p.teams?.id) === teamId);
    const goalRows = [
        { rows: homeRows, team: 'home', label: selectedMatch?.homeTeam, teamId: selectedMatch?.home_team_id },
        { rows: awayRows, team: 'away', label: selectedMatch?.awayTeam, teamId: selectedMatch?.away_team_id },
    ];

    const matchPanel = () => {
        if (!selectedMatch) return null;
        if (checkingStatus) return <Skeleton className="h-40 w-full" />;
        if (kickedOff(selectedMatch)) return <EmptyState title="Kickoff has passed">Predictions for this match are locked.</EmptyState>;
        if (hasPredicted) return <EmptyState title="Prediction locked">You have predicted this match. Points come after the final whistle.</EmptyState>;
        return (
            <div className="flex flex-col gap-6">
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Home score" type="number" min="0" max="20" inputMode="numeric" value={homeScore} onChange={(e) => setHomeScore(e.target.value)} required />
                    <Field label="Away score" type="number" min="0" max="20" inputMode="numeric" value={awayScore} onChange={(e) => setAwayScore(e.target.value)} required />
                </div>
                <p className="text-sm text-mut">{selectedMatch.homeTeam} against {selectedMatch.awayTeam}</p>
                {goalRows.map(({ rows, team, label, teamId }) => rows.length > 0 && (
                    <div key={team} className="flex flex-col gap-3">
                        <h3 className="font-semibold text-ink">{label} goals ({rows.length})</h3>
                        {rows.map((row, i) => (
                            <div key={`${team}-${i}`} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Field as="select" label={`${label} goal ${i + 1} scorer`} value={row.scorer} onChange={(e) => handleUpdateRow(team, i, 'scorer', e.target.value)} required>
                                    <option value="" disabled>Choose a scorer</option>
                                    {teamPlayers(teamId).map((p) => <option key={p.id} value={p.id}>{playerName(p)}{p.position ? ` (${p.position})` : ''}</option>)}
                                </Field>
                                <Field as="select" label={`${label} goal ${i + 1} assist`} value={row.assist} onChange={(e) => handleUpdateRow(team, i, 'assist', e.target.value)} required>
                                    <option value="" disabled>Choose an assist</option>
                                    <option value="Unassisted">Unassisted</option>
                                    {teamPlayers(teamId).filter((p) => p.id !== row.scorer).map((p) => <option key={`a-${p.id}`} value={p.id}>{playerName(p)}{p.position ? ` (${p.position})` : ''}</option>)}
                                </Field>
                            </div>
                        ))}
                    </div>
                ))}
                {submitError && <Notice tone="error" role="alert">{submitError}</Notice>}
                <button type="submit" disabled={submitting} className={PILL}>
                    {submitting ? 'Saving...' : 'Lock in prediction'}
                </button>
            </div>
        );
    };

    const predictionCard = (pred) => {
        const match = pred.matches;
        if (!match) return null;
        const isGraded = pred.status === 'graded';
        const pts = pred.points_awarded || 0;
        return (
            <div key={pred.id} className="glass flex flex-col gap-3 rounded-card p-5">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-mut">{new Date(match.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                    {isGraded ? <p className="font-display text-2xl font-bold tabular-nums">{pts > 0 ? '+' : ''}{pts} <span className="text-sm font-semibold text-mut">pts</span></p> : <Pill>Pending</Pill>}
                </div>
                <p className="text-ink">{match.home_team_name} vs {match.away_team_name}</p>
                <p className="text-sm text-mut tabular-nums">
                    Your prediction {pred.predicted_home_score}-{pred.predicted_away_score}
                    {isGraded && <> · Final {match.home_score}-{match.away_score}</>}
                </p>
                {isGraded && pred.breakdown?.length > 0 && (
                    <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                        {pred.breakdown.map((item, i) => (
                            <li key={i} className="flex justify-between gap-3 text-mut">
                                <span>{item.label}{item.detail ? `: ${item.detail}` : ''}</span>
                                <span className="tabular-nums text-ink">{item.points > 0 ? '+' : ''}{item.points}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    };

    const predictionsBody = () => {
        if (predError) return <ErrorState title="Could not load your predictions" message="Check your connection, then try again." onRetry={() => setHistoryAttempt((n) => n + 1)} />;
        if (predLoading) return <Skeleton className="h-28 w-full" />;
        if (filteredPredictions.length === 0) {
            return <EmptyState title={activeTab === 'pending' ? 'No pending predictions' : 'No graded predictions yet'}>Predictions appear here once you make them.</EmptyState>;
        }
        return (
            <div className="flex flex-col gap-3">
                {displayedPredictions.map(predictionCard)}
                {filteredPredictions.length > 5 && (
                    <Button variant="quiet" onClick={() => setShowAll(!showAll)} className="self-center">
                        {showAll ? 'Show fewer' : `Show all ${filteredPredictions.length}`}
                    </Button>
                )}
            </div>
        );
    };

    const tableBody = () => {
        if (lbLoading) return <Skeleton className="h-48 w-full" />;
        if (lbError) return <ErrorState title="Could not load the prediction table" message={lbError.message} onRetry={refetchLb} />;
        if (leaderboard.length === 0) return <EmptyState title="No points yet">The table fills in once predictions are graded.</EmptyState>;
        return (
            <ol className="glass flex flex-col divide-y divide-line/70 overflow-hidden rounded-card">
                {leaderboard.map((entry, index) => {
                    const isMe = entry.user_id === user?.id;
                    return (
                        <li key={entry.user_id} className={`flex items-center gap-4 px-4 py-4 sm:px-6 ${isMe ? 'bg-raise' : ''}`}>
                            <span className="w-8 font-display text-2xl tabular-nums text-mut">{index + 1}</span>
                            <span className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="flex items-center gap-2 font-black uppercase tracking-tight text-ink">
                                    <span className="truncate">{isMe ? myName : entry.username}</span>
                                    {isMe && <Pill tone="acc">You</Pill>}
                                </span>
                                {entry.flair && <span><Pill>{entry.flair}</Pill></span>}
                            </span>
                            <span className="font-display text-3xl tabular-nums text-ink">{entry.total_points.toLocaleString()}</span>
                        </li>
                    );
                })}
            </ol>
        );
    };

    return (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 bg-bg px-4 py-8 pb-12 text-ink">
            <div className="flex flex-col items-start gap-4">
                <Tabs
                    label="Predictions"
                    value="season1"
                    tabs={[{ id: 'season1', label: 'Season 1' }, { id: 'fifa', label: 'FIFA' }]}
                    onChange={(id) => setFantasySection(id)}
                />
                <div className="flex flex-col gap-3">
                    <h1 className="font-display text-4xl text-ink sm:text-6xl">Predictions</h1>
                    <p className="text-lg text-mut">Predict the score and the goalscorers. Points go on the prediction table.</p>
                </div>
            </div>

            {user && (
                <div className="flex items-center justify-between gap-4 rounded-card bg-blk p-5 text-blkink sm:p-8">
                    <div className="flex flex-col gap-2">
                        <p className="eyebrow text-blkink/70">{myName}{myActiveFlair ? ` · ${myActiveFlair}` : ''}</p>
                        <p className="font-display text-6xl leading-none tabular-nums">{myRank ? `#${myRank}` : '-'}</p>
                    </div>
                    <div className="text-right">
                        <p className="font-display text-6xl leading-none tabular-nums">{(myEntry?.total_points ?? 0).toLocaleString()}</p>
                        <p className="eyebrow mt-2 text-blkink/70">points</p>
                    </div>
                </div>
            )}

            <section aria-labelledby="scoring-heading" className="flex flex-col gap-3">
                <h2 id="scoring-heading" className="font-display text-3xl text-ink sm:text-4xl">How scoring works</h2>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-mut">
                    <li>300 points for the exact final score.</li>
                    <li>100 points for the right result (win, draw or loss).</li>
                    <li>Minus 10 points for each goal of difference that is wrong.</li>
                    <li>100 points for each correct goalscorer, and 50 for each correct assist.</li>
                </ul>
                <p className="text-sm text-mut">You can pick the same player more than once. Totals count, not order.</p>
            </section>

            <section aria-labelledby="predict-heading" className="flex flex-col gap-4">
                <h2 id="predict-heading" className="font-display text-3xl text-ink sm:text-4xl">Make a prediction</h2>
                {submitted ? (
                    <div className="glass flex flex-col items-start gap-4 rounded-card p-5 sm:p-8">
                        <Notice tone="success">Prediction saved. Points come once the match is graded.</Notice>
                        <Button variant="secondary" onClick={() => selectMatch('')}>Predict another match</Button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="glass flex flex-col gap-6 rounded-card p-5 sm:p-8">
                        {scheduleLoading ? <Skeleton className="h-11 w-full" /> : upcomingMatches.length === 0 ? (
                            <EmptyState title="No upcoming matches">Matches appear here once they are scheduled.</EmptyState>
                        ) : (
                            <Field as="select" label="Match" value={selectedMatchId} onChange={(e) => selectMatch(e.target.value)} required>
                                <option value="" disabled>Choose a match</option>
                                {upcomingMatches.map((m) => <option key={m.id} value={m.id}>{m.homeTeam} vs {m.awayTeam}</option>)}
                            </Field>
                        )}
                        {matchPanel()}
                    </form>
                )}
            </section>

            <section aria-label="Prediction results" className="flex flex-col gap-4">
                <Tabs
                    label="Prediction results"
                    value={activeTab}
                    onChange={setActiveTab}
                    tabs={[{ id: 'leaderboard', label: 'Prediction table' }, { id: 'pending', label: 'Pending' }, { id: 'history', label: 'History' }]}
                />
                {activeTab === 'leaderboard' ? tableBody() : predictionsBody()}
            </section>
        </div>
    );
}
