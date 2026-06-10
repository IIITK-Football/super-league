import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../context/LeagueContext';
import { createPortal } from 'react-dom';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { KnockoutBracket } from './KnockoutBracket';
import './FifaPrediction.css';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

export function FifaPrediction() {
    const { user, profile, signInWithGoogle } = useAuth();
    const navigate = useNavigate();
    const goBack = useCallback(() => navigate(-1), [navigate]);
    if (!user) {
        return (
            <div className="fifa-prediction-page flex items-center justify-center min-h-[80vh] text-center p-6">
                <div className="bg-black/60 border border-white/10 rounded-2xl p-10 max-w-md backdrop-blur-md shadow-2xl">
                    <h2 className="text-3xl font-fifa-italic text-white mb-4">ACCESS REQUIRED</h2>
                    <p className="text-zinc-400 mb-8 font-medium">You must be signed in to access the FIFA Fantasy League and submit predictions.</p>
                    <button
                        onClick={signInWithGoogle}
                        className="w-full bg-[var(--fifa-cyan)] text-black px-8 py-4 rounded-xl font-black uppercase tracking-widest hover:bg-white transition-colors"
                    >
                        Sign in with Google
                    </button>
                </div>
            </div>
        );
    }

    // Guard 2: Logged in, but missing World Cup Flair
    if (user && !profile?.wc_team_flair) {
        return (
            <div className="fifa-prediction-page flex items-center justify-center min-h-[80vh] text-center p-6">
                <div className="bg-black/60 border border-white/10 rounded-2xl p-10 max-w-md backdrop-blur-md shadow-2xl">
                    <h2 className="text-3xl font-fifa-italic text-[var(--fifa-gold)] mb-4">TEAM FLAIR MISSING</h2>
                    <p className="text-zinc-400 mb-8 font-medium">You need to select your World Cup team flair in your profile before entering the arena.</p>
                    <button
                        onClick={() => navigate('/profile')}
                        className="w-full bg-[var(--fifa-gold)] text-black px-8 py-4 rounded-xl font-black uppercase tracking-widest hover:bg-white transition-colors"
                    >
                        Go to Profile
                    </button>
                </div>
            </div>
        );
    }

    const [flagAnimationEnabled, setFlagAnimationEnabled] = useState(() => {
        try {
            const saved = localStorage.getItem('flagAnimationEnabled');
            return saved !== '0';
        } catch (e) {
            return true;
        }
    });

    const [dbGroups, setDbGroups] = useState(null);
    const [groupStandings, setGroupStandings] = useState(null);
    const [leaderboard, setLeaderboard] = useState([]);

    const PREDICTION_DEADLINE = new Date('2026-06-20T00:00:00Z');
    const isPastDeadline = new Date() > PREDICTION_DEADLINE;

    const [hasSubmitted, setHasSubmitted] = useState(false);

    const isLocked = hasSubmitted || isPastDeadline;

    // Knockout phase states
    const [predictionPhase, setPredictionPhase] = useState('groups');
    const [showThirdPlaceSection, setShowThirdPlaceSection] = useState(false);
    const [hasSelectedThirdPlace, setHasSelectedThirdPlace] = useState(false);
    const [selectedThirdPlaceGroups, setSelectedThirdPlaceGroups] = useState([]);

    useEffect(() => {
        try {
            const savedThirds = localStorage.getItem('selectedThirdPlace');
            if (savedThirds) {
                const parsed = JSON.parse(savedThirds);
                if (parsed.length <= 8) {
                    setSelectedThirdPlaceGroups(parsed);
                    if (parsed.length === 8) {
                        setHasSelectedThirdPlace(true);
                    }
                }
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    const thirdPlaceTeams = groupStandings ? Object.keys(groupStandings).map(group => {
        return {
            group,
            team: groupStandings[group][2]
        };
    }).filter(item => item.team) : [];

    const toggleThirdPlaceSelection = (group) => {
        if (selectedThirdPlaceGroups.includes(group)) {
            setSelectedThirdPlaceGroups(selectedThirdPlaceGroups.filter(g => g !== group));
        } else if (selectedThirdPlaceGroups.length < 8) {
            setSelectedThirdPlaceGroups([...selectedThirdPlaceGroups, group]);
        }
    };

    const handleProceedToKnockouts = () => {
        if (selectedThirdPlaceGroups.length === 8) {
            localStorage.setItem('selectedThirdPlace', JSON.stringify(selectedThirdPlaceGroups));
            setHasSelectedThirdPlace(true);
            setPredictionPhase('knockouts');
        }
    };

    useEffect(() => {
        const handleFifaBack = () => {
            if (predictionPhase === 'knockouts') {
                setPredictionPhase('groups');
            } else {
                goBack();
            }
        };
        window.addEventListener('fifaBackClicked', handleFifaBack);
        return () => window.removeEventListener('fifaBackClicked', handleFifaBack);
    }, [predictionPhase, goBack]);

    useEffect(() => {
        async function loadGroups() {
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL}/wc/teams`);
                const json = await res.json();
                if (json.success && json.data) {
                    const fetchedGroups = {};
                    json.data.forEach(team => {
                        const groupLetter = team.group_name.replace('Group ', '');
                        if (!fetchedGroups[groupLetter]) fetchedGroups[groupLetter] = [];
                        fetchedGroups[groupLetter].push({
                            id: team.id,
                            name: team.name,
                            logo_url: team.logo_url,
                            group: groupLetter
                        });
                    });

                    setDbGroups(fetchedGroups);

                    // Parse localStorage
                    let loadedStandings = null;
                    try {
                        const saved = localStorage.getItem('groupPredictions');
                        if (saved) {
                            const parsed = JSON.parse(saved);
                            const standings = {};
                            const allTeams = Object.values(fetchedGroups).flat();

                            Object.keys(parsed).forEach(group => {
                                standings[group] = parsed[group].map(item => {
                                    const teamStr = typeof item.team === 'string' ? item.team : (item.name || '');
                                    const foundTeam = allTeams.find(t => t.name === teamStr);

                                    if (foundTeam) {
                                        return { ...foundTeam };
                                    }

                                    return { name: teamStr };
                                });
                            });

                            const allGroupsValid = Object.keys(fetchedGroups).every(g => {
                                if (!standings[g] || standings[g].length !== 4) return false;
                                const fetchedNames = fetchedGroups[g].map(t => t.name);
                                const standingNames = standings[g].map(t => t.name);
                                const validTeams = standingNames.filter(name => fetchedNames.includes(name));
                                return validTeams.length === 4;
                            });

                            if (allGroupsValid) {
                                loadedStandings = standings;
                            }
                        }
                    } catch (e) {
                        console.error('Failed to load predictions', e);
                    }

                    setGroupStandings(loadedStandings || fetchedGroups);
                }
            } catch (err) {
                console.error('Failed to load db groups:', err);
            }
        }
        loadGroups();
    }, []);

    useEffect(() => {
        if (!user || !dbGroups) return;

        async function loadUserPredictions() {
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/groups?user_id=${user.id}`);
                const json = await res.json();

                if (json.success && json.data && json.data.length > 0) {
                    setHasSubmitted(true);
                    const standings = {};
                    const allTeams = Object.values(dbGroups).flat();

                    Object.keys(dbGroups).forEach(group => {
                        const pred = json.data.find(p => p.group_name === `Group ${group}`);
                        if (pred) {
                            standings[group] = [
                                allTeams.find(t => t.id === pred.first_place_id),
                                allTeams.find(t => t.id === pred.second_place_id),
                                allTeams.find(t => t.id === pred.third_place_id),
                                allTeams.find(t => t.id === pred.fourth_place_id)
                            ].filter(Boolean); // fallback

                            if (standings[group].length !== 4) {
                                standings[group] = dbGroups[group];
                            }
                        } else {
                            standings[group] = dbGroups[group];
                        }
                    });

                    setGroupStandings(standings);
                }
            } catch (err) {
                console.error('Failed to load user predictions from API:', err);
            }
        }

        loadUserPredictions();
    }, [user, dbGroups]);

    const allTeams = dbGroups ? Object.values(dbGroups).flat() : [];
    const userTeam = profile?.wc_team_flair ? allTeams.find(t => t.name === profile.wc_team_flair) : null;

    const [goldenBoot, setGoldenBoot] = useState(() => {
        try { return localStorage.getItem('fifaGoldenBoot') || ''; } catch (e) { return ''; }
    });
    const [goldenBootId, setGoldenBootId] = useState(() => {
        try { return localStorage.getItem('fifaGoldenBootId') || null; } catch (e) { return null; }
    });

    const [goldenGlove, setGoldenGlove] = useState(() => {
        try { return localStorage.getItem('fifaGoldenGlove') || ''; } catch (e) { return ''; }
    });
    const [goldenGloveId, setGoldenGloveId] = useState(() => {
        try { return localStorage.getItem('fifaGoldenGloveId') || null; } catch (e) { return null; }
    });

    const [goldenBall, setGoldenBall] = useState(() => {
        try { return localStorage.getItem('fifaGoldenBall') || ''; } catch (e) { return ''; }
    });
    const [goldenBallId, setGoldenBallId] = useState(() => {
        try { return localStorage.getItem('fifaGoldenBallId') || null; } catch (e) { return null; }
    });


    const [draggingTeam, setDraggingTeam] = useState(null); // { group, index }
    const [dragOverSlot, setDragOverSlot] = useState(null); // "groupName-index"
    const [particles, setParticles] = useState([]);
    const [showHint, setShowHint] = useState(false);

    // Set page title and set up IntersectionObserver AFTER data loads
    useEffect(() => {
        document.title = "FIFA World Cup 2026 — Prediction Challenge";

        // Wait until the data actually exists before trying to observe the elements!
        if (!dbGroups || !groupStandings) return;

        const io = new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    if (e.isIntersecting) e.target.classList.add("in");
                });
            },
            { threshold: 0.1 }
        );

        // Now it will successfully find the rendered sections
        document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

        return () => io.disconnect();

    }, [dbGroups, groupStandings, predictionPhase]); // <-- Added predictionPhase dependency

    const handleToggleFlags = (e) => {
        if (e) e.preventDefault();
        const enabled = !flagAnimationEnabled;
        setFlagAnimationEnabled(enabled);
        try {
            localStorage.setItem('flagAnimationEnabled', enabled ? '1' : '0');
        } catch (err) { }

        if (enabled) {
            setShowHint(true);
            setTimeout(() => setShowHint(false), 3000);
        } else {
            setParticles([]);
        }
    };

    // Spawn dynamic flag particle on click/touch
    const allFlags = [
        "🇨🇦", "🇺🇸", "🇲🇽", "🇯🇲", "🇨🇷", "🇵🇦", "🇹🇹", "🇭🇳", "🇳🇮", "🇧🇿", "🇸🇻", "🇬🇹", "🇨🇼",
        "🇦🇷", "🇧🇷", "🇺🇾", "🇨🇱", "🇨🇴", "🇵🇪", "🇯🇵", "🇰🇷", "🇸🇦", "🇮🇷", "🇦🇪", "🇺🇿", "🇮🇶",
        "🇦🇺", "🇨🇲", "🇰🇪", "🇲🇦", "🇬🇭", "🇦🇴", "🇫🇷", "🇬🇧", "🇩🇪", "🇪🇸", "🇮🇹", "🇳🇱", "🇧🇪",
        "🇵🇹", "🇦🇹", "🇨🇭", "🇷🇸", "🇭🇷", "🇵🇱", "🇸🇪", "🇷🇴", "🇺🇦"
    ];
    const floatAnimations = ["float1", "float2", "float3", "float4"];

    const spawnParticle = (clientX, clientY) => {
        if (!flagAnimationEnabled) return;

        const id = Math.random().toString(36).substr(2, 9);
        const randomFlag = allFlags[Math.floor(Math.random() * allFlags.length)];
        const randomAnimation = floatAnimations[Math.floor(Math.random() * floatAnimations.length)];
        const size = Math.random() * 12 + 28; // 28px to 40px

        const newParticle = {
            id,
            x: clientX,
            y: clientY,
            flag: randomFlag,
            animation: randomAnimation,
            size
        };

        setParticles(prev => [...prev, newParticle]);

        setTimeout(() => {
            setParticles(prev => prev.filter(p => p.id !== id));
        }, 10000); // Clean up after 10s
    };

    const handlePageClick = (e) => {
        if (e.target.closest('.pbtn, .btn-go, .btn-outline, .gtab, .sbox, .ni, .switch, .live-pill, .team-card, .group-slot, label, button, input, select')) {
            return;
        }
        spawnParticle(e.clientX, e.clientY);
    };

    // Drag and Drop handlers
    const handleDragStart = (e, group, index) => {
        setDraggingTeam({ group, index });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ group, index }));
    };

    const handleDragEnd = () => {
        setDraggingTeam(null);
        setDragOverSlot(null);
    };

    const handleDragOver = (e, group, index) => {
        e.preventDefault();
        if (draggingTeam && draggingTeam.group === group && draggingTeam.index !== index) {
            setDragOverSlot(`${group}-${index}`);
        }
    };

    const handleDragLeave = () => {
        setDragOverSlot(null);
    };

    const handleDrop = (e, targetGroup, targetIndex) => {
        e.preventDefault();
        setDragOverSlot(null);

        if (!draggingTeam) return;
        const { group: sourceGroup, index: sourceIndex } = draggingTeam;

        if (sourceGroup !== targetGroup) return; // Only swap within the same group

        const updatedTeams = [...groupStandings[targetGroup]];
        // Swap
        const temp = updatedTeams[sourceIndex];
        updatedTeams[sourceIndex] = updatedTeams[targetIndex];
        updatedTeams[targetIndex] = temp;

        setGroupStandings({
            ...groupStandings,
            [targetGroup]: updatedTeams
        });
    };

    const moveTeam = (groupName, currentIndex, direction) => {
        const updatedTeams = [...groupStandings[groupName]];
        const targetIndex = currentIndex + direction;

        // Prevent moving out of bounds
        if (targetIndex < 0 || targetIndex >= updatedTeams.length) return;

        // Swap the teams
        const temp = updatedTeams[currentIndex];
        updatedTeams[currentIndex] = updatedTeams[targetIndex];
        updatedTeams[targetIndex] = temp;

        setGroupStandings({
            ...groupStandings,
            [groupName]: updatedTeams
        });
    };

    const handleSubmit = async () => {
        if (!user) {
            alert("Please sign in to submit predictions!");
            return;
        }

        const groupPredictions = [];
        Object.keys(groupStandings).forEach(group => {
            const teams = groupStandings[group];
            if (teams.length === 4) {
                groupPredictions.push({
                    group_name: `Group ${group}`,
                    first_place_id: teams[0].id,
                    second_place_id: teams[1].id,
                    third_place_id: teams[2].id,
                    fourth_place_id: teams[3].id
                });
            }
        });

        try {
            const {
                data: { session }
            } = await supabase.auth.getSession();

            const token = session?.access_token;

            const groupRes = await fetch(
                `${import.meta.env.VITE_API_URL}/wc/predictions/groups`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        user_id: user.id,
                        predictions: groupPredictions
                    })
                }
            );

            const awardsRes = await fetch(
                `${import.meta.env.VITE_API_URL}/wc/predictions/awards`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        user_id: user.id,
                        golden_boot_id: goldenBootId,
                        golden_ball_id: goldenBallId,
                        golden_glove_id: goldenGloveId
                    })
                }
            );

            if (!groupRes.ok) {
                console.log(await groupRes.text());
            }

            if (!awardsRes.ok) {
                console.log(await awardsRes.text());
            }

            if (!groupRes.ok || !awardsRes.ok) {
                throw new Error("API request failed");
            }

            console.log("Predictions Submitted to API!");
            alert("Predictions submitted successfully!");
            setHasSubmitted(true);
            setShowThirdPlaceModal(true); // Automatically show modal after submission
        } catch (e) {
            console.error("API submission failed:", e);
            alert("Failed to submit to database. Saving locally instead. " + e.message);
            setHasSubmitted(true);
            setShowThirdPlaceModal(true);
        }

        // Still save to local storage as fallback
        try {
            const legacyPredictions = {};
            Object.keys(groupStandings).forEach(group => {
                legacyPredictions[group] = groupStandings[group].map((team, index) => ({
                    position: index + 1,
                    team: team.name
                }));
            });
            localStorage.setItem('groupPredictions', JSON.stringify(legacyPredictions));

            localStorage.setItem('fifaGoldenBoot', goldenBoot);
            if (goldenBootId) localStorage.setItem('fifaGoldenBootId', goldenBootId);
            localStorage.setItem('fifaGoldenGlove', goldenGlove);
            if (goldenGloveId) localStorage.setItem('fifaGoldenGloveId', goldenGloveId);
            localStorage.setItem('fifaGoldenBall', goldenBall);
            if (goldenBallId) localStorage.setItem('fifaGoldenBallId', goldenBallId);
        } catch (e) {
            console.error("Could not save predictions:", e);
        }
    };

    useEffect(() => {
        async function fetchLeaderboard() {
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL}/wc/leaderboard`);
                const json = await res.json();

                if (json.success) {
                    // Filter out anyone who doesn't have a World Cup flair set
                    const filteredLeaderboard = json.data.filter(
                        player => player.user_profiles && player.user_profiles.wc_team_flair
                    );

                    setLeaderboard(filteredLeaderboard);
                }
            } catch (err) {
                console.error("Leaderboard fetch failed", err);
            }
        }
        fetchLeaderboard();
    }, []);

    const [portalTarget, setPortalTarget] = useState(null);
    useEffect(() => {
        setPortalTarget(document.getElementById('navbar-portal-target'));
    }, []);
    const toggleContent = (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <button
                onClick={handleToggleFlags}
                title="Toggle background flag animations"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '50px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: '600',
                    color: '#fff',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                }}
            >
                <span style={{
                    color: flagAnimationEnabled ? '#00e676' : '#ff5252',
                    fontWeight: '800'
                }}>
                    Flags {flagAnimationEnabled ? 'ON' : 'OFF'}
                </span>
            </button>

            {showHint && (
                <div style={{
                    position: 'absolute',
                    top: '130%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#ffffff',
                    color: '#000000',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontWeight: '800',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    animation: 'fadeUp 0.3s ease forwards',
                    pointerEvents: 'none',
                    zIndex: 100
                }}>
                    Click anywhere on the screen!
                </div>
            )}
        </div>
    );

    if (!dbGroups || !groupStandings) {
        return (
            <div data-testid="page-wc" className="fifa-prediction-page" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', color: '#fff' }}>
                <div className="bg-canvas">
                    <div className="bg-ring bg-ring-1"></div>
                    <div className="bg-ring bg-ring-2"></div>
                    <div className="bg-ballgrid"></div>
                </div>
                <h2 style={{ zIndex: 10, fontFamily: '"Montserrat", sans-serif' }}>Loading Tournament Data...</h2>
            </div>
        );
    }

    if (predictionPhase === 'knockouts') {
        return <KnockoutBracket onBack={() => setPredictionPhase('groups')} />;
    }

    return (
        <div className="fifa-prediction-page" onClick={handlePageClick}>
            {portalTarget && createPortal(toggleContent, portalTarget)}



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
                <div className="bg-corner-br"></div>
            </div>

            {/* Dynamic Flag Particles */}
            {particles.map(p => (
                <div
                    key={p.id}
                    className={`dynamic-flag ${p.animation}`}
                    style={{
                        left: p.x,
                        top: p.y,
                        fontSize: `${p.size}px`,
                        transform: 'translate(-50%, -50%)',
                        position: 'fixed'
                    }}
                >
                    {p.flag}
                </div>
            ))}

            {/* Floating Country Flags */}
            <div className="particles-wrap" aria-hidden="true" style={{ display: flagAnimationEnabled ? 'block' : 'none' }}>
                <div className="pt">🇨🇦</div>
                <div className="pt">🇺🇸</div>
                <div className="pt">🇲🇽</div>
                <div className="pt">🇯🇲</div>
                <div className="pt">🇨🇷</div>
                <div className="pt">🇵🇦</div>
                <div className="pt">🇹🇹</div>
                <div className="pt">🇭🇳</div>
                <div className="pt">🇳🇮</div>
                <div className="pt">🇧🇿</div>
                <div className="pt">🇸🇻</div>
                <div className="pt">🇬🇹</div>
                <div className="pt">🇨🇼</div>
                <div className="pt">🇦🇷</div>
                <div className="pt">🇧🇷</div>
                <div className="pt">🇺🇾</div>
                <div className="pt">🇨🇱</div>
                <div className="pt">🇨🇴</div>
                <div className="pt">🇵🇪</div>
                <div className="pt">🇯🇵</div>
                <div className="pt">🇰🇷</div>
                <div className="pt">🇸🇦</div>
                <div className="pt">🇮🇷</div>
                <div className="pt">🇦🇪</div>
                <div className="pt">🇺🇿</div>
                <div className="pt">🇮🇶</div>
                <div className="pt">🇦🇺</div>
                <div className="pt">🇨🇲</div>
                <div className="pt">🇰🇪</div>
                <div className="pt">🇲🇦</div>
                <div className="pt">🇬🇭</div>
                <div className="pt">🇦🇴</div>
                <div className="pt">🇫🇷</div>
                <div className="pt">🇬🇧</div>
                <div className="pt">🇩🇪</div>
                <div className="pt">🇪🇸</div>
                <div className="pt">🇮🇹</div>
                <div className="pt">🇳🇱</div>
                <div className="pt">🇧🇪</div>
                <div className="pt">🇵🇹</div>
                <div className="pt">🇦🇹</div>
                <div className="pt">🇨🇭</div>
                <div className="pt">🇷🇸</div>
                <div className="pt">🇭🇷</div>
                <div className="pt">🇵🇱</div>
                <div className="pt">🇸🇪</div>
                <div className="pt">🇷🇴</div>
                <div className="pt">🇺🇦</div>
            </div>

            <div className="page" style={{ paddingBottom: '100px' }}>
                <header className="hero" style={{ paddingBottom: '0' }}>
                    <h1 className="hero-title font-fifa-italic" style={{ fontSize: 'clamp(3.5rem, 8vw, 6rem)', lineHeight: '1.1' }}>
                        FIFA FANTASY<br /><span className="glow-word">LEAGUE</span>
                    </h1>
                </header>

                {/* Knockout Stage Proceed Button */}
                {isLocked && !hasSelectedThirdPlace && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
                        <button
                            onClick={() => {
                                setShowThirdPlaceSection(true);
                                setTimeout(() => {
                                    document.getElementById('third-place-section')?.scrollIntoView({ behavior: 'smooth' });
                                }, 100);
                            }}
                            style={{
                                background: '#fff', color: '#000', border: 'none', padding: '16px 32px',
                                borderRadius: '8px', fontWeight: '800', fontSize: '18px', cursor: 'pointer',
                                fontFamily: '"Montserrat", sans-serif', textTransform: 'uppercase',
                                boxShadow: '0 4px 15px rgba(255,255,255,0.2)'
                            }}
                        >
                            Proceed to round of 32
                        </button>
                    </div>
                )}

                {isLocked && hasSelectedThirdPlace && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
                        <button
                            onClick={() => setPredictionPhase('knockouts')}
                            style={{
                                background: '#fff', color: '#000', border: 'none', padding: '16px 32px',
                                borderRadius: '8px', fontWeight: '800', fontSize: '18px', cursor: 'pointer',
                                fontFamily: '"Montserrat", sans-serif', textTransform: 'uppercase',
                                boxShadow: '0 4px 15px rgba(255,255,255,0.2)'
                            }}
                        >
                            Predict Knockout Stages
                        </button>
                    </div>
                )}

                {/* Top Dash Sections */}
                <div className="user-dash-top">

                    {/* Standings/Login Card */}
                    {user ? (
                        <div className="bg-black/30 border border-white/10 rounded-2xl p-5 sm:p-8 flex items-center justify-between shadow-lg backdrop-blur-md transition-all hover:bg-black/50" style={{ flex: 1, width: '100%' }}>
                            <div className="flex items-center gap-3 sm:gap-6">

                                {/* Rank */}
                                <div className="flex flex-col items-center justify-center mr-2">
                                    <span className="text-zinc-500 text-[9px] font-bold tracking-widest uppercase mb-1">Rank</span>
                                    <span className="text-2xl font-fifa text-white leading-none">{profile?.rank || '-'}</span>
                                </div>

                                {/* Avatar */}
                                <div className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 bg-white/5 flex items-center justify-center shadow-md">
                                    {userTeam ? (
                                        <img
                                            src={userTeam.logo_url}
                                            alt={userTeam.name}
                                            className="w-full h-full object-cover bg-white"
                                        />
                                    ) : (
                                        <span className="text-[10px] font-bold text-zinc-500">YOU</span>
                                    )}
                                </div>

                                {/* Info */}
                                <div className="text-left flex flex-col justify-center">
                                    <p className="text-lg font-fifa text-white leading-none tracking-wide mb-1">
                                        {profile?.nickname || 'Predictor'}
                                    </p>
                                    {profile?.wc_team_flair && (
                                        <span className="text-[10px] text-zinc-400 font-medium tracking-wide flex items-center gap-1.5 uppercase">
                                            {profile.wc_team_flair}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Points */}
                            <div className="text-right flex flex-col items-end justify-center">
                                <div className="text-2xl font-fifa text-white leading-none mb-1">
                                    {leaderboard.find(p => p.user_profiles?.nickname === profile?.nickname)?.points || 0}
                                </div>
                                <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none">
                                    Points
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="lb-wrap" style={{ flex: 1, minWidth: '320px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '24px', textAlign: 'center' }}>
                            <h3 className="font-fifa" style={{ fontSize: '24px', color: 'var(--fifa-cyan)', marginBottom: '8px' }}>LOGIN REQUIRED</h3>
                            <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '14px', marginBottom: '16px' }}>You must log in to participate and submit predictions.</p>
                            <button
                                onClick={signInWithGoogle}
                                style={{ background: 'var(--fifa-cyan)', color: '#000', border: 'none', padding: '10px 24px', borderRadius: '8px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 auto' }}
                            >
                                Sign in with Google
                            </button>
                        </div>
                    )}

                    {/* Scoring rules */}
                    <div className="lb-wrap" style={{ flex: 1, minWidth: '320px' }}>
                        <div className="lb-hdr" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', background: 'rgba(0, 0, 0, 0.2)', justifyContent: 'center', padding: '16px' }}>
                            <span className="lb-hdr-t font-fifa" style={{ fontSize: '20px' }}>HOW TO PLAY</span>
                        </div>
                        <div className="dash-rules" style={{ padding: '20px 24px' }}>
                            <div className="dash-rule-row">
                                <div className="rule-badge" style={{ background: 'var(--fifa-green)' }}>GROUP STAGES</div>
                                <div className="rule-text">
                                    <span className="rule-highlight">5 Points</span> for each team placed in their exact correct standing.
                                </div>
                            </div>
                            <div className="dash-rule-row">
                                <div className="rule-badge" style={{ background: 'var(--fifa-gold)' }}>AWARDS</div>
                                <div className="rule-text">
                                    <span className="rule-highlight">100 Points</span> for predicting the Golden Boot, Glove, or Ball.
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
                <div className="fifa-desktop-layout">
                    <div className="fifa-main-content">

                        <section className="section reveal" id="groups">
                            <div className="sh" style={{ marginBottom: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                <h2 className="font-fifa-italic" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', color: 'white', lineHeight: '1.2', letterSpacing: '0.05em' }}>
                                    PREDICT THE GROUP <span style={{ color: 'var(--fifa-gold)' }}>STAGES</span>
                                </h2>
                                <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontWeight: '500', marginTop: '12px', fontSize: '15px', maxWidth: '500px' }}>
                                    Drag and position teams in each group to predict the group stage standings
                                </p>
                            </div>
                            {isLocked && (
                                <div style={{
                                    background: 'rgba(0, 0, 0, 0.4)',
                                    border: '1px solid var(--fifa-gold)',
                                    padding: '16px 24px',
                                    borderRadius: '12px',
                                    marginBottom: '32px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '8px',
                                    maxWidth: '600px',
                                    margin: '0 auto 32px auto',
                                    backdropFilter: 'blur(8px)'
                                }}>
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--fifa-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                    </svg>
                                    <span className="font-fifa" style={{ color: 'var(--fifa-gold)', fontSize: '20px', letterSpacing: '1px' }}>
                                        PREDICTIONS LOCKED
                                    </span>
                                    <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px', margin: '0 0 16px 0', textAlign: 'center' }}>
                                        {isPastDeadline
                                            ? "The deadline for Group Stage predictions has officially passed."
                                            : "Predictions already made for the Group Stage. Proceed to the knockouts!"}
                                    </p>
                                    {hasSelectedThirdPlace && (
                                        <button
                                            onClick={() => setPredictionPhase('knockouts')}
                                            style={{
                                                background: 'var(--fifa-cyan)', color: '#000', border: 'none', padding: '12px 24px',
                                                borderRadius: '8px', fontWeight: '800', fontSize: '16px', cursor: 'pointer',
                                                fontFamily: '"Montserrat", sans-serif', textTransform: 'uppercase'
                                            }}
                                        >
                                            Predict Knockout Stages
                                        </button>
                                    )}
                                </div>
                            )}
                            <div className="groups-container">
                                {Object.keys(groupStandings).map((groupName) => (
                                    <div className="group-card" key={groupName}>
                                        <div className="group-header-row">
                                            <div className="group-header">GROUP {groupName}</div>
                                        </div>
                                        <div className="group-list-container">
                                            <div className="group-list" data-group={groupName}>
                                                {groupStandings[groupName].map((team, idx) => {
                                                    const isAdvancing = idx < 2;
                                                    const slotKey = `${groupName}-${idx}`;
                                                    const isDraggingThis = draggingTeam && draggingTeam.group === groupName && draggingTeam.index === idx;
                                                    const positionText = ["1st", "2nd", "3rd", "4th"][idx];

                                                    return (
                                                        <div className="group-row" key={idx}>
                                                            <div className="rank-label">{positionText}</div>
                                                            <div
                                                                className={`group-slot ${isAdvancing ? 'advancing' : 'eliminated'} ${dragOverSlot === slotKey ? 'drag-over' : ''
                                                                    }`}
                                                                data-position={idx + 1}
                                                                onDragOver={(e) => handleDragOver(e, groupName, idx)}
                                                                onDragLeave={handleDragLeave}
                                                                onDrop={(e) => handleDrop(e, groupName, idx)}
                                                            >
                                                                <div
                                                                    className={`team-card ${isAdvancing ? '' : 'eliminated'} ${isDraggingThis ? 'dragging' : ''
                                                                        }`}
                                                                    draggable={!isLocked}
                                                                    onDragStart={(e) => handleDragStart(e, groupName, idx)}
                                                                    onDragEnd={handleDragEnd}
                                                                    data-team={team.name}
                                                                >
                                                                    <div className="team-info" style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, paddingRight: '8px' }}>
                                                                        <img src={team.logo_url} alt={team.name} className="team-flag-img" style={{ flexShrink: 0 }} />
                                                                        <span className="team-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.name}</span>
                                                                    </div>

                                                                    {/* NEW: Mobile-friendly Up/Down Buttons */}
                                                                    {!isLocked && (
                                                                        <>
                                                                            <div className="mobile-move-controls" style={{ display: 'flex', flexDirection: 'column', marginRight: '4px', flexShrink: 0 }}>
                                                                                <button
                                                                                    onClick={(e) => { e.preventDefault(); moveTeam(groupName, idx, -1); }}
                                                                                    disabled={idx === 0}
                                                                                    style={{
                                                                                        background: 'transparent', border: 'none', padding: '0px 8px', fontSize: '12px',
                                                                                        color: idx === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.8)',
                                                                                        cursor: idx === 0 ? 'default' : 'pointer'
                                                                                    }}
                                                                                >
                                                                                    ▲
                                                                                </button>
                                                                                <button
                                                                                    onClick={(e) => { e.preventDefault(); moveTeam(groupName, idx, 1); }}
                                                                                    disabled={idx === 3}
                                                                                    style={{
                                                                                        background: 'transparent', border: 'none', padding: '0px 8px', fontSize: '12px',
                                                                                        color: idx === 3 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.8)',
                                                                                        cursor: idx === 3 ? 'default' : 'pointer'
                                                                                    }}
                                                                                >
                                                                                    ▼
                                                                                </button>
                                                                            </div>
                                                                        </>
                                                                    )}

                                                                    {/* Existing Desktop Drag Handle */}
                                                                    <div className="drag-handle" style={{ opacity: 0.5 }}>
                                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Tournament Awards Section */}
                            <div className="sh" style={{ marginTop: '60px', marginBottom: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                <h2 className="font-fifa-italic" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', color: 'white', lineHeight: '1.2', letterSpacing: '0.05em' }}>
                                    TOURNAMENT <span style={{ color: 'var(--fifa-gold)' }}>AWARDS</span>
                                </h2>
                            </div>

                            <div className="groups-container" style={{ marginBottom: '40px' }}>
                                <div className="group-card">
                                    <div className="group-header-row">
                                        <div className="group-header">GOLDEN BOOT</div>
                                    </div>
                                    <div className="group-list">
                                        <div className="group-row">
                                            <div className="group-slot advancing" style={{ pointerEvents: isLocked ? 'none' : 'auto', opacity: isLocked ? 0.7 : 1 }}>
                                                <AutocompleteInput
                                                    placeholder="Best Scorer..."
                                                    value={goldenBoot}
                                                    onChange={setGoldenBoot}
                                                    onSelect={(player) => setGoldenBootId(player.id)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="group-card">
                                    <div className="group-header-row">
                                        <div className="group-header">GOLDEN GLOVE</div>
                                    </div>
                                    <div className="group-list">
                                        <div className="group-row">
                                            <div className="group-slot advancing" style={{ pointerEvents: isLocked ? 'none' : 'auto', opacity: isLocked ? 0.7 : 1 }}>
                                                <AutocompleteInput
                                                    placeholder="Best Goalkeeper..."
                                                    value={goldenGlove}
                                                    onChange={setGoldenGlove}
                                                    onSelect={(player) => setGoldenGloveId(player.id)}
                                                    positionFilter="GK"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="group-card">
                                    <div className="group-header-row">
                                        <div className="group-header">GOLDEN BALL</div>
                                    </div>
                                    <div className="group-list">
                                        <div className="group-row">
                                            <div className="group-slot advancing" style={{ pointerEvents: isLocked ? 'none' : 'auto', opacity: isLocked ? 0.7 : 1 }}>
                                                <AutocompleteInput
                                                    placeholder="Best Player..."
                                                    value={goldenBall}
                                                    onChange={setGoldenBall}
                                                    onSelect={(player) => setGoldenBallId(player.id)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {!isLocked && (
                                <div className="submit-section">
                                    <button className="submit-btn" id="submitBtn" onClick={handleSubmit}>
                                        Submit Predictions
                                    </button>
                                </div>
                            )}

                            {showThirdPlaceSection && !hasSelectedThirdPlace && (
                                <div id="third-place-section" style={{ marginTop: '60px' }}>
                                    <div className="sh" style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                        <h2 className="font-fifa-italic" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', color: 'white', lineHeight: '1.2', letterSpacing: '0.05em' }}>
                                            CHOOSE THE BEST THIRD PLACE <span style={{ color: 'var(--fifa-gold)' }}>TEAM</span>
                                        </h2>
                                        <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontWeight: '500', marginTop: '12px', fontSize: '15px', maxWidth: '500px' }}>
                                            {selectedThirdPlaceGroups.length}/8 SELECTED
                                        </p>
                                    </div>

                                    <div className="groups-container">
                                        <div className="group-card" style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
                                            <div className="group-list-container">
                                                <div className="group-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', padding: '16px' }}>
                                                    {thirdPlaceTeams.map(({ group, team }) => {
                                                        const isSelected = selectedThirdPlaceGroups.includes(group);
                                                        const isDisabled = !isSelected && selectedThirdPlaceGroups.length >= 8;

                                                        return (
                                                            <div
                                                                key={group}
                                                                className={`team-card ${isSelected ? 'selected' : ''}`}
                                                                onClick={() => !isDisabled && toggleThirdPlaceSelection(group)}
                                                                style={{
                                                                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                                                                    opacity: isDisabled ? 0.4 : 1,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    padding: '12px',
                                                                    background: isSelected ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255,255,255,0.05)',
                                                                    border: isSelected ? '2px solid #FFFFFF' : '1px solid rgba(255,255,255,0.1)',
                                                                    borderRadius: '8px',
                                                                    boxShadow: isSelected ? '0 0 10px rgba(255,255,255,0.3)' : 'none'
                                                                }}
                                                            >
                                                                <div className="team-info" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                                                                    <img src={team.logo_url} alt={team.name} className="team-flag-img" style={{ width: '32px', height: '32px', marginRight: '12px' }} />
                                                                    <span className="team-name">{team.name}</span>
                                                                </div>
                                                                {isSelected && (
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                        <polyline points="20 6 9 17 4 12"></polyline>
                                                                    </svg>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="submit-section" style={{ marginTop: '32px' }}>
                                        <button
                                            className="submit-btn"
                                            disabled={selectedThirdPlaceGroups.length !== 8}
                                            onClick={handleProceedToKnockouts}
                                            style={{
                                                background: selectedThirdPlaceGroups.length === 8 ? 'var(--fifa-gold)' : 'rgba(255,255,255,0.1)',
                                                color: selectedThirdPlaceGroups.length === 8 ? '#000' : 'rgba(255,255,255,0.3)',
                                                cursor: selectedThirdPlaceGroups.length === 8 ? 'pointer' : 'not-allowed'
                                            }}
                                        >
                                            Confirm 8 Teams
                                        </button>
                                    </div>
                                </div>
                            )}

                            {hasSelectedThirdPlace && (
                                <div style={{ marginTop: '60px' }}>
                                    <div className="sh" style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                        <h2 className="font-fifa-italic" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', color: 'white', lineHeight: '1.2', letterSpacing: '0.05em' }}>
                                            QUALIFIED THIRD PLACE <span style={{ color: 'var(--fifa-gold)' }}>TEAMS</span>
                                        </h2>
                                    </div>

                                    <div className="groups-container">
                                        <div className="group-card" style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
                                            <div className="group-list-container">
                                                <div className="group-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', padding: '16px' }}>
                                                    {thirdPlaceTeams.filter(t => selectedThirdPlaceGroups.includes(t.group)).map(({ group, team }) => {
                                                        return (
                                                            <div
                                                                key={group}
                                                                className="team-card selected"
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    padding: '12px',
                                                                    background: 'rgba(0, 0, 0, 0.6)',
                                                                    border: '1px solid rgba(255,255,255,0.2)',
                                                                    borderRadius: '8px'
                                                                }}
                                                            >
                                                                <div className="team-info" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                                                                    <img src={team.logo_url} alt={team.name} className="team-flag-img" style={{ width: '32px', height: '32px', marginRight: '12px' }} />
                                                                    <span className="team-name">{team.name}</span>
                                                                </div>
                                                                <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', marginLeft: '12px' }}>Group {group}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>

                    </div>
                    <div className="fifa-side-content">
                        <section className="section">
                            <div className="sh">
                                <div className="st font-fifa">
                                    <div className="st-bar" style={{ '--bc': 'var(--fifa-gold)' }}></div>
                                    Leaderboard
                                </div>
                            </div>

                            {/* Added maxHeight and overflowY so the 80+ users scroll inside this box instead of stretching the page! */}
                            <div className="lb-wrap" style={{ maxHeight: '600px', overflowY: 'auto', paddingRight: '10px' }}>
                                <div className="lb-hdr">
                                    <span className="lb-hdr-t font-fifa">Top Predictors</span>
                                </div>

                                {leaderboard.map((player, idx) => {
                                    // Determine medal colors for top 3
                                    let rankColor = '#fff';
                                    if (idx === 0) rankColor = 'var(--fifa-gold)';
                                    else if (idx === 1) rankColor = '#c0c0c0';
                                    else if (idx === 2) rankColor = '#cd7f32';

                                    // Find the logo for their flair
                                    const playerFlair = player.user_profiles?.wc_team_flair;
                                    const playerTeam = playerFlair ? allTeams.find(t => t.name === playerFlair) : null;

                                    return (
                                        <div className="lb-row" key={idx} style={{ marginBottom: '12px' }}>
                                            <span className="lb-rk font-fifa" style={{ color: rankColor }}>{idx + 1}</span>
                                            <div className="lbav overflow-hidden bg-white/5 border border-white/30" style={{ borderColor: rankColor }}>
                                                {playerTeam ? (
                                                    <img src={playerTeam.logo_url} alt={playerTeam.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <span style={{ fontSize: '10px', color: rankColor }}>--</span>
                                                )}
                                            </div>
                                            <div className="lb-inf">
                                                <div className="lb-nm" style={{ fontWeight: '800' }}>{player.user_profiles?.nickname || 'Predictor'}</div>
                                                {playerTeam && (
                                                    <div className="lb-ct flex items-center gap-2 uppercase">
                                                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>{playerTeam.name}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="lb-sc">
                                                <div className="lb-p font-fifa" style={{ color: rankColor }}>{player.points}</div>
                                                <div className="lb-pl">pts</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
