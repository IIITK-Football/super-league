import React, { useState, useEffect, useRef } from 'react';
import { MatchNode } from '../components/bracket/MatchNode';
import { generateRoundOf32, generateEmptyKnockouts } from '../utils/fifaBracketLogic';
import './KnockoutBracket.css';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

//OFFICIAL TOURNAMENT RESULTS
const OFFICIAL_R16 = ["Canada", "Morocco", "Paraguay", "France", "Brazil", "Norway", "Mexico", "England", "Portugal", "Spain", "United States", "Belgium", "Argentina", "Egypt", "Switzerland", "Colombia"];
const OFFICIAL_QF = [
  "France", 
  "Morocco", 
  "Spain", 
  "Belgium", 
  "Norway", 
  "England", 
  "Argentina", 
  "Switzerland"
];
const OFFICIAL_SF = [
  "France",
  "Spain",
  "England",
  "Argentina"
]; // Max capacity: 4

const OFFICIAL_FINAL = [
    "Spain",
  "Argentina"];   // Max capacity: 2
  
const OFFICIAL_CHAMPION = ["Spain"]; // Max capacity: 1

const FullScreenConfetti = () => {
    const [particles, setParticles] = useState([]);

    useEffect(() => {
        const colors = ['#ffd700', '#00b140', '#00a5e0', '#e31b23', '#ffffff'];
        const newParticles = Array.from({ length: 150 }).map((_, i) => {
            const isLeft = i % 2 === 0;
            const startX = isLeft ? 0 : 100;
            const startY = 100;

            const angle = isLeft ? (Math.random() * 30 + 45) : (Math.random() * 30 + 105);
            const radians = angle * (Math.PI / 180);
            const velocity = Math.random() * 50 + 50;

            const tx = Math.cos(radians) * velocity;
            const ty = -Math.sin(radians) * velocity;

            const delay = Math.random() * 0.2;
            const color = colors[Math.floor(Math.random() * colors.length)];

            return { id: i, startX, startY, tx, ty, delay, color };
        });
        setParticles(newParticles);

        const timer = setTimeout(() => setParticles([]), 4000);
        return () => clearTimeout(timer);
    }, []);

    if (particles.length === 0) return null;

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
            {particles.map(p => (
                <div
                    key={p.id}
                    style={{
                        position: 'absolute',
                        left: `${p.startX}%`,
                        top: `${p.startY}%`,
                        width: '12px',
                        height: '12px',
                        backgroundColor: p.color,
                        borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                        '--tx': `${p.tx}vw`,
                        '--ty': `${p.ty}vh`,
                        animation: `firework 2.5s cubic-bezier(0.25, 1, 0.5, 1) ${p.delay}s forwards`
                    }}
                />
            ))}
        </div>
    );
};

export function KnockoutBracket({ onBack, viewingOtherUser }) {
    const { user } = useAuth();
    const headerRef = useRef(null);

    const [isLocked, setIsLocked] = useState(false);
    const [bracketState, setBracketState] = useState(null);
    const [showFireworks, setShowFireworks] = useState(false);
    const [svgLines, setSvgLines] = useState([]);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showRotatePrompt, setShowRotatePrompt] = useState(false);
    const dismissedRef = useRef(false);

    useEffect(() => {
        const checkOrientation = () => {
            if (dismissedRef.current) return;
            const isMobile = window.innerWidth <= 950;
            const isPortrait = window.innerHeight > window.innerWidth;
            setShowRotatePrompt(isMobile && isPortrait);
        };

        checkOrientation();

        window.addEventListener("resize", checkOrientation);
        window.addEventListener("orientationchange", checkOrientation);

        return () => {
            window.removeEventListener("resize", checkOrientation);
            window.removeEventListener("orientationchange", checkOrientation);
        };
    }, []);

    // Keep state synced if user exits fullscreen using phone gestures/ESC key
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullScreen = async () => {
        if (!document.fullscreenElement) {
            try {
                const elem = document.documentElement; // Make the whole page fullscreen
                if (elem.requestFullscreen) await elem.requestFullscreen();
                else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen(); // Safari

                // ONCE IN FULLSCREEN, FORCE LANDSCAPE!
                if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
                    await window.screen.orientation.lock('landscape').catch(e => console.log('Orientation lock ignored by iOS:', e));
                }
            } catch (err) {
                console.error("Error attempting to enable fullscreen:", err);
            }
        } else {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
                // UNLOCK ORIENTATION ON EXIT
                if (window.screen && window.screen.orientation && window.screen.orientation.unlock) {
                    window.screen.orientation.unlock();
                }
            }
        }
    };

    useEffect(() => {
        document.body.classList.add('knockout-mode');
        document.body.style.backgroundColor = '#030303';
        document.documentElement.style.backgroundColor = '#030303';

        // Lock zoom so the background always covers the content
        const viewportMeta = document.querySelector('meta[name="viewport"]');
        const originalContent = viewportMeta?.getAttribute('content');
        if (viewportMeta) {
            viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no');
        }

        return () => {
            document.body.classList.remove('knockout-mode');
            document.body.style.backgroundColor = '';
            document.documentElement.style.backgroundColor = '';
            if (viewportMeta && originalContent) {
                viewportMeta.setAttribute('content', originalContent);
            }
        };
    }, []);

    const calculateLines = () => {
        const lines = [];
        if (!bracketState) return;

        const wrapper = document.querySelector('.kb-bracket-wrapper');
        if (!wrapper) return;
        const wrapperRect = wrapper.getBoundingClientRect();

        const getCenter = (element) => {
            const rect = element.getBoundingClientRect();
            return {
                left: rect.left - wrapperRect.left,
                right: rect.right - wrapperRect.left,
                y: rect.top - wrapperRect.top + rect.height / 2,
                width: rect.width
            };
        };

        const allMatches = [
            ...bracketState.roundOf32,
            ...bracketState.roundOf16,
            ...bracketState.quarterFinals,
            ...bracketState.semiFinals
        ];

        allMatches.forEach(match => {
            if (!match.nextMatchId) return;

            const el = document.querySelector(`[data-match-id="${match.id}"]`);
            const nextEl = document.querySelector(`[data-match-id="${match.nextMatchId}"]`);

            if (el && nextEl) {
                const feeders = allMatches.filter(m => m.nextMatchId === match.nextMatchId)
                    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
                const isTopFeeder = feeders[0]?.id === match.id;

                const from = getCenter(el);
                const toMatch = getCenter(nextEl);

                const teamSlots = nextEl.querySelectorAll('.mn-team');
                let targetY = toMatch.y;
                if (teamSlots && teamSlots.length === 2) {
                    const slotCenter = getCenter(teamSlots[isTopFeeder ? 0 : 1]);
                    targetY = slotCenter.y;
                }

                const startX = from.right;
                const startY = from.y;
                const endX = toMatch.left;
                const endY = targetY;
                const midX = startX + (endX - startX) / 2;

                lines.push({
                    id: `${match.id}-${match.nextMatchId}`,
                    path: `M ${startX},${startY} L ${midX},${startY} L ${midX},${endY} L ${endX},${endY}`
                });
            }
        });

        setSvgLines(lines);
    };

    useEffect(() => {
        calculateLines();
        window.addEventListener('resize', calculateLines);
        return () => window.removeEventListener('resize', calculateLines);
    }, [bracketState]);

    useEffect(() => {
        const loadBracketData = async () => {
            try {
                let savedDbData = null;

                // 1. Check DB as the ONLY source of truth for saved knockouts
                const targetUserId = viewingOtherUser ? viewingOtherUser.userId : user?.id;
                if (targetUserId) {
                    try {
                        const koRes = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/knockouts?user_id=${targetUserId}`);
                        const koJson = await koRes.json();
                        if (koJson.success && koJson.data) {
                            setIsLocked(true);
                            savedDbData = koJson.data;
                        } else if (viewingOtherUser) {
                            alert("This user hasn't submitted knockout predictions yet.");
                            if (onBack) onBack(); return;
                        }
                    } catch (err) { console.error("Lock check failed", err); }
                }

                if (viewingOtherUser) {
                    setIsLocked(true);
                }

                // NO MORE LOCAL STORAGE CACHE HERE! It forces a clean slate if DB is empty.

                // 2. Fallback to generation using Groups
                const savedGroups = localStorage.getItem('groupPredictions');
                const savedThirds = localStorage.getItem('selectedThirdPlace');

                if (!savedGroups || !savedThirds) {
                    if (onBack) onBack(); return;
                }

                const groupPredictions = JSON.parse(savedGroups);
                const { data: { session } } = await supabase.auth.getSession();

                let masterTeams = [];
                try {
                    const teamsRes = await fetch(`${import.meta.env.VITE_API_URL}/wc/teams`);
                    const teamsJson = await teamsRes.json();
                    if (teamsJson.success) masterTeams = teamsJson.data;
                } catch (err) { console.error("Failed to fetch teams"); }

                const resolveTeam = (rawTeam) => {
                    if (!rawTeam) return null;
                    const code = rawTeam.position_code;
                    if (!code) return null;

                    const position = parseInt(code.charAt(0), 10);
                    const groupLetter = code.charAt(1);

                    if (groupPredictions[groupLetter] && groupPredictions[groupLetter][position - 1]) {
                        const teamName = groupPredictions[groupLetter][position - 1].team || groupPredictions[groupLetter][position - 1].name;
                        const dbTeam = masterTeams.find(t => t.name === teamName);

                        if (dbTeam) return { id: dbTeam.id, name: dbTeam.name, logo_url: dbTeam.logo_url };
                        return { id: teamName, name: teamName, logo_url: '' };
                    }
                    return { id: `placeholder-${code}`, name: code, logo_url: '' };
                };

                const genRes = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/knockouts/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
                    body: JSON.stringify({ user_id: targetUserId, advancing_third_place_groups: JSON.parse(savedThirds) })
                });

                const genJson = await genRes.json();
                if (!genJson.success) { alert("Generation failed"); if (onBack) onBack(); return; }

                const r32Matches = genJson.data.round_of_32.map((match, i) => ({
                    id: `m${i + 1}`,
                    nextMatchId: `m${Math.floor(i / 2) + 17}`,
                    team1: resolveTeam(match.team1),
                    team2: resolveTeam(match.team2),
                    winnerId: null
                }));

                const emptyKnockouts = generateEmptyKnockouts();
                const cleanState = {
                    roundOf32: r32Matches,
                    roundOf16: emptyKnockouts.roundOf16,
                    quarterFinals: emptyKnockouts.quarterFinals,
                    semiFinals: emptyKnockouts.semiFinals,
                    final: emptyKnockouts.final
                };

                // 3. Reconstruct Bracket visually if DB data exists
                if (savedDbData) {
                    const extractId = (val) => typeof val === 'object' && val !== null ? (val.winnerId || val.id) : val;

                    const applyWinners = (roundKey, teamIds) => {
                        if (!Array.isArray(teamIds)) return;
                        teamIds.forEach(rawId => {
                            const id = extractId(rawId);
                            const match = cleanState[roundKey].find(m => m.team1?.id === id || m.team2?.id === id);
                            if (match) {
                                match.winnerId = id;
                                const winnerTeam = match.team1?.id === id ? match.team1 : match.team2;
                                if (match.nextMatchId) {
                                    const nextMatch = Object.values(cleanState).flat().find(m => m.id === match.nextMatchId);
                                    if (nextMatch) {
                                        const feeders = cleanState[roundKey].filter(m => m.nextMatchId === nextMatch.id).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
                                        if (feeders[0]?.id === match.id) nextMatch.team1 = winnerTeam;
                                        else if (feeders[1]?.id === match.id) nextMatch.team2 = winnerTeam;
                                    }
                                }
                            }
                        });
                    };

                    const preds = savedDbData.predictions || savedDbData;
                    applyWinners('roundOf32', preds.round_of_16 || []);
                    applyWinners('roundOf16', preds.quarter_finals || []);
                    applyWinners('quarterFinals', preds.semi_finals || []);
                    applyWinners('semiFinals', preds.final || []);
                    const champId = extractId(preds.champion_id);
                    if (champId) applyWinners('final', [champId]);
                }

                setBracketState(cleanState);

            } catch (e) {
                console.error("Critical error:", e);
                if (onBack) onBack();
            }
        };

        loadBracketData();
    }, [user?.id, viewingOtherUser, onBack]);

    const handleSelectWinner = (matchId, winnerTeam) => {
        if (isLocked) return;

        setBracketState(prev => {
            const newState = JSON.parse(JSON.stringify(prev)); // Deep copy to prevent reference bugs
            let matchFound = null;
            let currentRound = null;

            // 1. Find the match
            Object.keys(newState).forEach(roundKey => {
                const m = newState[roundKey].find(m => m.id === matchId);
                if (m) { matchFound = m; currentRound = roundKey; }
            });

            if (!matchFound) return prev;
            if (matchFound.winnerId === winnerTeam.id) return prev; // Ignore if clicking same winner

            // 2. Set new winner
            matchFound.winnerId = winnerTeam.id;

            // Trigger fireworks if final
            if (newState.final.some(m => m.id === matchId)) {
                setShowFireworks(true);
                setTimeout(() => setShowFireworks(false), 4000);
            }

            // 3. CASCADE CLEAR FORWARD
            // Automatically clears future matches if the user changes their mind earlier in the bracket!
            let currMatch = matchFound;
            let pushedWinner = winnerTeam;

            while (currMatch && currMatch.nextMatchId) {
                const nextMatch = Object.values(newState).flat().find(m => m.id === currMatch.nextMatchId);
                if (!nextMatch) break;

                // Figure out which slot the current match feeds into
                let currentRoundMatches = [];
                Object.keys(newState).forEach(k => {
                    if (newState[k].some(m => m.id === currMatch.id)) currentRoundMatches = newState[k];
                });

                const feeders = currentRoundMatches.filter(m => m.nextMatchId === nextMatch.id).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

                // Push the new team forward
                if (feeders[0]?.id === currMatch.id) nextMatch.team1 = pushedWinner;
                else if (feeders[1]?.id === currMatch.id) nextMatch.team2 = pushedWinner;

                // If this future match ALREADY had a winner, it's now invalid. Clear it!
                if (nextMatch.winnerId) {
                    nextMatch.winnerId = null;
                    currMatch = nextMatch;
                    pushedWinner = null; // Propagates null forward to wipe out any deeper team slots
                } else {
                    break; // Stop cascading if the future match was empty anyway
                }
            }

            return newState;
        });
    };

    const handleScroll = (e) => {
        if (headerRef.current) {
            headerRef.current.style.transform = `translateX(-${e.target.scrollLeft}px)`;
        }
    };

    const submitKnockouts = async () => {
        const finalWinnerId = bracketState.final[0].winnerId;

        if (!finalWinnerId) {
            alert("Please complete the entire bracket before submitting!");
            return;
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const savedThirds = localStorage.getItem('selectedThirdPlace');
            const advancingThirds = savedThirds ? JSON.parse(savedThirds) : [];

            // CRITICAL FIX: Extract exactly the integers needed for each round!
            // The 16 teams in R16 are the winners of R32
            const r16Teams = bracketState.roundOf32.map(m => m.winnerId).filter(Boolean);
            // The 8 teams in QF are the winners of R16
            const qfTeams = bracketState.roundOf16.map(m => m.winnerId).filter(Boolean);
            // The 4 teams in SF are the winners of QF
            const sfTeams = bracketState.quarterFinals.map(m => m.winnerId).filter(Boolean);
            // The 2 teams in Final are the winners of SF
            const finalTeams = bracketState.semiFinals.map(m => m.winnerId).filter(Boolean);

            const payload = {
                user_id: user?.id,
                advancing_third_place_groups: advancingThirds,
                predictions: {
                    round_of_16: r16Teams,
                    quarter_finals: qfTeams,
                    semi_finals: sfTeams,
                    final: finalTeams,
                    champion_id: finalWinnerId
                }
            };

            const res = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/knockouts/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
                body: JSON.stringify(payload)
            });

            const json = await res.json();

            if (res.ok && json.success) {
                alert("Bracket Predictions Submitted Successfully!");
                setIsLocked(true);
                if (onBack) {
                    onBack(true); // indicate that knockout predictions were just submitted
                }
            } else {
                throw new Error(json.error || "Submission failed");
            }
        } catch (err) {
            console.error("Failed to submit bracket:", err);
            alert("Failed to sync with server.");
        }
    };


    if (!bracketState || !bracketState.roundOf32) {
        return (
            <div className="kb-page">
                <div className="bg-canvas"><div className="bg-ballgrid"></div></div>
                <div className="kb-loading font-fifa">Loading Bracket...</div>
            </div>
        );
    }

    return (
        <div className="kb-page">

            {showRotatePrompt && (
                <div className="kb-rotate-prompt-overlay">
                    <div className="kb-rotate-prompt-box">
                        <button
                            onClick={() => {
                                dismissedRef.current = true;
                                setShowRotatePrompt(false);
                            }}
                            style={{
                                position: 'absolute',
                                top: '12px',
                                right: '12px',
                                background: 'rgba(255,255,255,0.1)',
                                border: 'none',
                                borderRadius: '50%',
                                width: '32px',
                                height: '32px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                color: 'white',
                                zIndex: 10
                            }}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                        <svg
                            width="64"
                            height="64"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--fifa-gold)"
                            strokeWidth="2"
                            style={{ marginBottom: 16 }}
                        >
                            <rect x="5" y="2" width="14" height="20" rx="2" />
                            <line x1="12" y1="18" x2="12.01" y2="18" />
                        </svg>


                        <p>
                            For the best viewing experience, we recommend switching to fullscreen mode.
                        </p>

                        {!isFullscreen && (
                            <button
                                className="kb-submit-btn"
                                onClick={toggleFullScreen}
                                style={{ marginTop: "20px" }}
                            >
                                Enter Full Screen
                            </button>
                        )}

                        {/* Optional message after entering fullscreen */}
                        {isFullscreen && (
                            <p style={{ marginTop: "20px", color: "#FFD700", fontWeight: 600 }}>
                                ✅ Great! Now rotate your device to landscape.
                            </p>
                        )}
                    </div>
                </div>
            )}


            {/* NEW: Floating Fullscreen Button */}
            <button
                onClick={toggleFullScreen}
                className="kb-fullscreen-btn"
                title="Toggle Fullscreen"
            >
                {isFullscreen ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" /></svg>
                ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
                )}
            </button>

            {showFireworks && <FullScreenConfetti />}
            <div className="bg-canvas">
                <div className="bg-ring bg-ring-1"></div>
                <div className="bg-ring bg-ring-2"></div>
                <div className="bg-slab-1"></div>
                <div className="bg-slab-2"></div>
                <div className="bg-slab-3"></div>
                <div className="bg-slab-4"></div>
                <div className="bg-ballgrid"></div>
                <div className="bg-rules"></div>
                <div className="bg-wm-26 font-fifa">26</div>
                <div className="bg-corner-tl"></div>
                <div className="bg-corner-tr"></div>
                <div className="bg-corner-bl"></div>
                <div className="bg-corner-br"></div>
            </div>

            <header className="kb-header" style={{ flexDirection: 'column', paddingBottom: '20px' }}>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-start', padding: '16px 24px', position: 'absolute', top: 0, left: 0, zIndex: 100 }}>
                    <button 
                        onClick={() => onBack && onBack()} 
                        style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                    >
                        ← Back
                    </button>
                </div>
                <h1 className="font-fifa-italic" style={{ marginBottom: '20px', marginTop: '40px' }}>
                    {viewingOtherUser ? (
                        <>{viewingOtherUser.nickname.toUpperCase()}'S <span style={{ color: 'var(--fifa-gold)' }}>BRACKET</span></>
                    ) : (
                        <>KNOCKOUT <span style={{ color: 'var(--fifa-gold)' }}>BRACKET</span></>
                    )}
                </h1>

                <div className="lb-wrap" style={{ width: '100%', maxWidth: '800px', margin: '0 auto', background: 'rgba(0,0,0,0.5)' }}>
                    <div className="lb-hdr" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', background: 'rgba(0, 0, 0, 0.2)', justifyContent: 'center', padding: '16px' }}>
                        <span className="lb-hdr-t font-fifa" style={{ fontSize: '20px' }}>
                            {viewingOtherUser ? `${viewingOtherUser.nickname.toUpperCase()}'S PREDICTIONS` : (isLocked ? "YOUR PREDICTIONS" : "SCORING RULES")}
                        </span>
                    </div>
                    <div className="dash-rules" style={{ padding: '20px 24px' }}>
                        <p style={{ color: '#fff', opacity: 0.8, fontSize: '14px', marginBottom: '16px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
                            {viewingOtherUser 
                                ? `These are the official knockout predictions submitted by ${viewingOtherUser.nickname}.`
                                : (isLocked
                                    ? "These are your officially submitted predictions. Good luck!"
                                    : "Points are awarded for each team correctly predicted to win their matchup and advance to the subsequent round:")}
                        </p>
                        {!isLocked && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>ROUND OF 32</span>
                                    <span style={{ color: '#fff', fontSize: '14px' }}>- <span className="rule-highlight">35 points</span> each</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>ROUND OF 16</span>
                                    <span style={{ color: '#fff', fontSize: '14px' }}>- <span className="rule-highlight">75 points</span> each</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>QUARTER-FINAL</span>
                                    <span style={{ color: '#fff', fontSize: '14px' }}>- <span className="rule-highlight">150 points</span> each</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>SEMI-FINAL</span>
                                    <span style={{ color: '#fff', fontSize: '14px' }}>- <span className="rule-highlight">200 points</span> each</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>WORLD CUP WINNER</span>
                                    <span style={{ color: '#fff', fontSize: '14px' }}>- <span className="rule-highlight">300 points</span></span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <div className="kb-header-wrapper" style={{ zIndex: 50, background: 'var(--fifa-blue)', boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)' }}>
                <div className="kb-rounds-header font-fifa" ref={headerRef} style={{ width: 'max-content' }}>
                    <div className="kb-round-header-item">R32</div>
                    <div className="kb-round-header-item">R16</div>
                    <div className="kb-round-header-item">QF</div>
                    <div className="kb-round-header-item">SF</div>
                    <div className="kb-round-header-item">FINAL</div>
                </div>
            </div>

            <div className="kb-scroll-container" onScroll={handleScroll}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="kb-bracket-wrapper" style={{ paddingBottom: '50px' }}>
                        <svg className="kb-svg-overlay" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}>
                            {svgLines.map(line => (
                                <path key={line.id} d={line.path} fill="none" stroke="rgba(255, 255, 255, 0.8)" strokeWidth="2" strokeLinejoin="round" />
                            ))}
                        </svg>

                        <div className="kb-round">
                            <div className="kb-match-list r32">
                                {bracketState.roundOf32.map(m => (
                                    <div className="kb-match-wrapper" key={m.id} data-match-id={m.id}>
                                        {/* R32 winners advance to R16. Target = 16 */}
                                        <MatchNode match={m} onSelectWinner={handleSelectWinner} officialAdvances={OFFICIAL_R16} roundCapacity={16} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="kb-round">
                            <div className="kb-match-list r16">
                                {bracketState.roundOf16.map(m => (
                                    <div className="kb-match-wrapper" key={m.id} data-match-id={m.id}>
                                        {/* R16 winners advance to QF. Target = 8 */}
                                        <MatchNode match={m} onSelectWinner={handleSelectWinner} officialAdvances={OFFICIAL_QF} roundCapacity={8} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="kb-round">
                            <div className="kb-match-list qf">
                                {bracketState.quarterFinals.map(m => (
                                    <div className="kb-match-wrapper" key={m.id} data-match-id={m.id}>
                                        {/* QF winners advance to SF. Target = 4 */}
                                        <MatchNode match={m} onSelectWinner={handleSelectWinner} officialAdvances={OFFICIAL_SF} roundCapacity={4} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="kb-round">
                            <div className="kb-match-list sf">
                                {bracketState.semiFinals.map(m => (
                                    <div className="kb-match-wrapper" key={m.id} data-match-id={m.id}>
                                        {/* SF winners advance to Final. Target = 2 */}
                                        <MatchNode match={m} onSelectWinner={handleSelectWinner} officialAdvances={OFFICIAL_FINAL} roundCapacity={2} />
                                    </div>
                                ))}
                            </div>
                        </div>

                       <div className="kb-round final-round">
                            <div className="kb-match-list final" style={{ position: 'relative' }}>
                                {bracketState.final[0].winnerId && (
                                    <div className="kb-champion">
                                        <div className="kb-champion-card">
                                            {(() => {
                                                const finalMatch = bracketState.final[0];
                                                const winner = finalMatch.team1?.id === finalMatch.winnerId ? finalMatch.team1 : finalMatch.team2;
                                                return (
                                                    <>
                                                        <div className="kb-celebration">
                                                            <img src={winner.logo_url} alt={winner.name} className="kb-champion-flag" />
                                                            <div className="confetti c1"></div>
                                                            <div className="confetti c2"></div>
                                                            <div className="confetti c3"></div>
                                                            <div className="confetti c4"></div>
                                                            <div className="confetti c5"></div>
                                                        </div>
                                                        <span className="kb-champion-name">{winner.name}</span>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                )}

                                <div className="kb-final-shield-container">
                                    <div className="kb-final-shield-text">FIFA WORLD CUP 2026 winner</div>
                                </div>

                                {bracketState.final.map(m => (
                                    <div className="kb-match-wrapper" key={m.id} data-match-id={m.id}>
                                        {/* Final winner advances to Champion. Target = 1 */}
                                        <MatchNode match={m} onSelectWinner={handleSelectWinner} isFinal={true} officialAdvances={OFFICIAL_CHAMPION} roundCapacity={1} />
                                    </div>
                                ))}

                                {!isLocked && (
                                    <button className="kb-submit-btn white-btn" onClick={submitKnockouts} style={{ marginTop: '24px', padding: '12px', fontSize: '16px', width: '100%' }}>
                                        Submit
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
