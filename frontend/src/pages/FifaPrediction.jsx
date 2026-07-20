import React, { useState, useEffect ,useCallback} from 'react';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../context/LeagueContext';
import { createPortal } from 'react-dom';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { KnockoutBracket } from './KnockoutBracket';
import './FifaPrediction.css';
import { supabase } from '../lib/supabase';
import { useNavigate, useLocation } from 'react-router-dom';
import officialStandings from '../data/officialStandings.json';

export function FifaPrediction() {
  const { user, profile, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  const goBack=useCallback(()=>{
    navigate(-1);
  },[navigate]);

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

  const PREDICTION_DEADLINE = new Date('2026-06-22T00:00:00Z'); 
  const isPastDeadline = new Date() > PREDICTION_DEADLINE;
  
  // NEW: Granular submission states
  const [hasSubmittedAwards, setHasSubmittedAwards] = useState(false);
  const [hasSubmittedGroups, setHasSubmittedGroups] = useState(false);
  const [hasKnockoutPrediction, setHasKnockoutPrediction] = useState(false);

  // NEW: Internal View Router ('home' | 'groups' | 'third_place')
  const [activeView, setActiveView] = useState('home');

  // NEW: Viewing other users
  const [viewingOtherUser, setViewingOtherUser] = useState(null); // { userId, nickname }
  const [otherUserStandings, setOtherUserStandings] = useState(null);

  const handleViewOtherUserPredictions = async (userId, nickname) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/groups?user_id=${userId}`);
      const json = await res.json();
      
      if (json.success && json.data && json.data.length > 0) {
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
            ].filter(Boolean);
            if (standings[group].length !== 4) standings[group] = dbGroups[group];
          } else {
            standings[group] = dbGroups[group]; // fallback if incomplete
          }
        });
        setOtherUserStandings(standings);
        setViewingOtherUser({ userId, nickname });
        setActiveView('groups');
        window.scrollTo(0, 0);
      } else {
        alert(`${nickname} hasn't submitted group predictions yet.`);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to load predictions.');
    }
  };

  const handleBackToMyPredictions = () => {
    setViewingOtherUser(null);
    setOtherUserStandings(null);
    setActiveView('home');
  };


  const isAwardsLocked = hasSubmittedAwards || isPastDeadline;
  const isGroupsLocked = hasSubmittedGroups || isPastDeadline;

  // Knockout phase states
  const [predictionPhase, setPredictionPhase] = useState('groups');
  const [hasSelectedThirdPlace, setHasSelectedThirdPlace] = useState(false);
  const [selectedThirdPlaceGroups, setSelectedThirdPlaceGroups] = useState([]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('phase') === 'knockouts') {
      setPredictionPhase('knockouts');
    } else {
      setPredictionPhase('groups');
    }
  }, [location.search]);

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

  const goToKnockouts = () => {
    if (groupStandings) {
      try {
        const legacyPredictions = {};
        Object.keys(groupStandings).forEach(group => {
          legacyPredictions[group] = groupStandings[group].map((team, index) => ({
            position: index + 1,
            team: team.name
          }));
        });
        localStorage.setItem('groupPredictions', JSON.stringify(legacyPredictions));
      } catch (e) {
        console.error(e);
      }
    }
    navigate('/wc?phase=knockouts');
    window.scrollTo(0, 0);
  };

  const handleProceedToKnockouts = () => {
    if (selectedThirdPlaceGroups.length === 8) {
      localStorage.setItem('selectedThirdPlace', JSON.stringify(selectedThirdPlaceGroups));
      setHasSelectedThirdPlace(true);
      goToKnockouts();
    }
  };

  // Modified back handler to integrate with our new activeView router
  useEffect(() => {
    const handleFifaBack = () => {
      if (predictionPhase === 'knockouts') {
        setPredictionPhase('groups');
      } else if (activeView !== 'home') {
        setActiveView('home');
      } else {
        goBack();
      }
    };
    window.addEventListener('fifaBackClicked', handleFifaBack);
    return () => window.removeEventListener('fifaBackClicked', handleFifaBack);
  }, [predictionPhase, activeView, goBack]);

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
                  if (foundTeam) return { ...foundTeam };
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
        // 1. Fetch Group Stage Predictions
        const groupRes = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/groups?user_id=${user.id}`);
        const groupJson = await groupRes.json();
        
        if (groupJson.success && groupJson.data && groupJson.data.length > 0) {
          setHasSubmittedGroups(true);
          const standings = {};
          const allTeams = Object.values(dbGroups).flat();
          
          Object.keys(dbGroups).forEach(group => {
            const pred = groupJson.data.find(p => p.group_name === `Group ${group}`);
            if (pred) {
              standings[group] = [
                allTeams.find(t => t.id === pred.first_place_id),
                allTeams.find(t => t.id === pred.second_place_id),
                allTeams.find(t => t.id === pred.third_place_id),
                allTeams.find(t => t.id === pred.fourth_place_id)
              ].filter(Boolean);
              if (standings[group].length !== 4) standings[group] = dbGroups[group];
            } else {
              standings[group] = dbGroups[group];
            }
          });
          setGroupStandings(standings);
        }

        // 2. Fetch Knockout Predictions
        const koRes = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/knockouts?user_id=${user.id}`);
        const koJson = await koRes.json();
        
        if (koJson.success && koJson.data) {
          setHasKnockoutPrediction(true);
          setHasSelectedThirdPlace(true);
          
          const savedThirds = koJson.data.advancing_third_place_groups;
          if (savedThirds && savedThirds.length === 8) {
            setSelectedThirdPlaceGroups(savedThirds);
            localStorage.setItem('selectedThirdPlace', JSON.stringify(savedThirds));
          }
        }

      } catch (err) {
        console.error('Failed to load user predictions from API:', err);
      }
    }
    
    loadUserPredictions();
  }, [user, dbGroups]);

  useEffect(() => {
    if (!user) return;
    
    async function loadAwardPredictions() {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/awards?user_id=${user.id}`);
        const json = await res.json();
        
        if (json.success && json.data) {
          const d = json.data;
          let hasAwards = false;
          if (d.golden_boot?.name) {
            setGoldenBoot(d.golden_boot.name);
            setGoldenBootId(d.golden_boot.id);
            hasAwards = true;
          }
          if (d.golden_glove?.name) {
            setGoldenGlove(d.golden_glove.name);
            setGoldenGloveId(d.golden_glove.id);
            hasAwards = true;
          }
          if (d.golden_ball?.name) {
            setGoldenBall(d.golden_ball.name);
            setGoldenBallId(d.golden_ball.id);
            hasAwards = true;
          }
          if (hasAwards) setHasSubmittedAwards(true);
        }
      } catch (err) {
        console.error('Failed to load award predictions:', err);
      }
    }
    
    loadAwardPredictions();
  }, [user]);

  const allTeams = dbGroups ? Object.values(dbGroups).flat() : [];
  const userTeam = profile?.wc_team_flair ? allTeams.find(t => t.name === profile.wc_team_flair) : null;

  const [goldenBoot, setGoldenBoot] = useState(() => {
    try { return localStorage.getItem('fifaGoldenBoot') || ''; } catch(e) { return ''; }
  });
  const [goldenBootId, setGoldenBootId] = useState(() => {
    try { return localStorage.getItem('fifaGoldenBootId') || null; } catch(e) { return null; }
  });

  const [goldenGlove, setGoldenGlove] = useState(() => {
    try { return localStorage.getItem('fifaGoldenGlove') || ''; } catch(e) { return ''; }
  });
  const [goldenGloveId, setGoldenGloveId] = useState(() => {
    try { return localStorage.getItem('fifaGoldenGloveId') || null; } catch(e) { return null; }
  });

  const [goldenBall, setGoldenBall] = useState(() => {
    try { return localStorage.getItem('fifaGoldenBall') || ''; } catch(e) { return ''; }
  });
  const [goldenBallId, setGoldenBallId] = useState(() => {
    try { return localStorage.getItem('fifaGoldenBallId') || null; } catch(e) { return null; }
  });

  const [draggingTeam, setDraggingTeam] = useState(null); 
  const [dragOverSlot, setDragOverSlot] = useState(null); 
  const [particles, setParticles] = useState([]);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    document.title = "FIFA World Cup 2026 — Prediction Challenge";  
    if (!dbGroups || !groupStandings) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("in");
        });
      },
      { threshold: 0.1 }
    );
    
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
    
  }, [dbGroups, groupStandings, predictionPhase]); 

  const handleToggleFlags = (e) => {
    if (e) e.preventDefault();
    const enabled = !flagAnimationEnabled;
    setFlagAnimationEnabled(enabled);
    try {
      localStorage.setItem('flagAnimationEnabled', enabled ? '1' : '0');
    } catch (err) {}
    
    if (enabled) {
      setShowHint(true);
      setTimeout(() => setShowHint(false), 3000);
    } else {
      setParticles([]);
    }
  };

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
    const size = Math.random() * 12 + 28; 
    const newParticle = { id, x: clientX, y: clientY, flag: randomFlag, animation: randomAnimation, size };
    setParticles(prev => [...prev, newParticle]);
    setTimeout(() => { setParticles(prev => prev.filter(p => p.id !== id)); }, 10000);
  };

  const handlePageClick = (e) => {
    if (e.target.closest('.pbtn, .btn-go, .btn-outline, .gtab, .sbox, .ni, .switch, .live-pill, .team-card, .group-slot, label, button, input, select')) {
      return;
    }
    spawnParticle(e.clientX, e.clientY);
  };

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
    if (sourceGroup !== targetGroup) return; 
    
    const updatedTeams = [...groupStandings[targetGroup]];
    const temp = updatedTeams[sourceIndex];
    updatedTeams[sourceIndex] = updatedTeams[targetIndex];
    updatedTeams[targetIndex] = temp;
    
    setGroupStandings({ ...groupStandings, [targetGroup]: updatedTeams });
  };

  const moveTeam = (groupName, currentIndex, direction) => {
    const updatedTeams = [...groupStandings[groupName]];
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= updatedTeams.length) return;

    const temp = updatedTeams[currentIndex];
    updatedTeams[currentIndex] = updatedTeams[targetIndex];
    updatedTeams[targetIndex] = temp;

    setGroupStandings({ ...groupStandings, [groupName]: updatedTeams });
  };

  // Dedicated Award Submitter
  const handleSubmitAwards = async () => {
    try {
      localStorage.setItem('fifaGoldenBoot', goldenBoot);
      if (goldenBootId) localStorage.setItem('fifaGoldenBootId', goldenBootId);
      localStorage.setItem('fifaGoldenGlove', goldenGlove);
      if (goldenGloveId) localStorage.setItem('fifaGoldenGloveId', goldenGloveId);
      localStorage.setItem('fifaGoldenBall', goldenBall);
      if (goldenBallId) localStorage.setItem('fifaGoldenBallId', goldenBallId);
    } catch (e) {
      console.error("Could not save awards locally:", e);
    }

    if (!user) {
      alert("Please sign in to save your predictions! We will redirect you to login.");
      signInWithGoogle();
      return;
    }
    if (!profile?.wc_team_flair) {
      alert("Please select your World Cup team flair in your profile before submitting.");
      navigate('/profile');
      return;
    }
    if (!goldenBootId || !goldenGloveId || !goldenBallId) {
      alert("Please select predictions for all three awards to continue.");
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      const awardsRes = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/awards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          user_id: user.id,
          golden_boot_id: goldenBootId,
          golden_ball_id: goldenBallId,
          golden_glove_id: goldenGloveId
        })
      });

      if (!awardsRes.ok) throw new Error("Awards API request failed");
      alert("Awards submitted successfully! You have unlocked the bracket.");
      setHasSubmittedAwards(true);
    } catch (e) {
      console.error("API submission failed:", e);
      alert("Failed to submit to database. Saving locally instead. " + e.message);
      setHasSubmittedAwards(true);
    }
  };

  // Dedicated Group Submitter
  const handleSubmitGroups = async () => {
    try {
      const legacyPredictions = {};
      Object.keys(groupStandings).forEach(group => {
        legacyPredictions[group] = groupStandings[group].map((team, index) => ({
          position: index + 1,
          team: team.name
        }));
      });
      localStorage.setItem('groupPredictions', JSON.stringify(legacyPredictions));
    } catch (e) {
      console.error("Could not save groups locally:", e);
    }

    if (!user) {
      alert("Please sign in to save your predictions!");
      signInWithGoogle();
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
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const groupRes = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: user.id, predictions: groupPredictions })
      });

      if (!groupRes.ok) throw new Error("Groups API request failed");

      alert("Group stages submitted successfully! Proceeding to Top 32...");
      setHasSubmittedGroups(true);
      setActiveView('third_place');
    } catch (e) {
      console.error("API submission failed:", e);
      alert("Failed to submit to database. Saving locally instead. " + e.message);
      setHasSubmittedGroups(true);
      setActiveView('third_place');
    }
  };

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/wc/leaderboard`);
        const json = await res.json();
        
        if (json.success) {
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
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '50px', padding: '4px 10px', fontSize: '11px', fontWeight: '600',
            color: '#fff', cursor: 'pointer', transition: 'all 0.2s ease'
        }}
      >
        <span style={{ color: flagAnimationEnabled ? '#00e676' : '#ff5252', fontWeight: '800' }}>
          Flags {flagAnimationEnabled ? 'ON' : 'OFF'}
        </span>
      </button>

      {showHint && (
        <div style={{
          position: 'absolute', top: '130%', left: '50%', transform: 'translateX(-50%)',
          background: '#ffffff', color: '#000000', padding: '6px 12px', borderRadius: '8px',
          fontSize: '11px', fontWeight: '800', whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          animation: 'fadeUp 0.3s ease forwards', pointerEvents: 'none', zIndex: 100
        }}>
          Click anywhere on the screen!
        </div>
      )}
    </div>
  );

  if (!dbGroups || !groupStandings) {
    return (
      <div className="fifa-prediction-page" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', color: '#fff' }}>
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
    return (
      <KnockoutBracket
        viewingOtherUser={viewingOtherUser}
        onBack={(refresh = false) => {
          if (refresh) {
            window.location.reload();
          } else {
            setPredictionPhase('groups');
          }
        }}
      />
    );
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

      {particles.map(p => (
        <div key={p.id} className={`dynamic-flag ${p.animation}`} style={{ left: p.x, top: p.y, fontSize: `${p.size}px`, transform: 'translate(-50%, -50%)', position: 'fixed' }}>
          {p.flag}
        </div>
      ))}

      <div className="particles-wrap" aria-hidden="true" style={{ display: flagAnimationEnabled ? 'block' : 'none' }}>
        <div className="pt">🇨🇦</div><div className="pt">🇺🇸</div><div className="pt">🇲🇽</div>
        <div className="pt">🇯🇲</div><div className="pt">🇨🇷</div><div className="pt">🇵🇦</div>
        <div className="pt">🇹🇹</div><div className="pt">🇭🇳</div><div className="pt">🇳🇮</div>
        <div className="pt">🇧🇿</div><div className="pt">🇸🇻</div><div className="pt">🇬🇹</div>
        <div className="pt">🇨🇼</div><div className="pt">🇦🇷</div><div className="pt">🇧🇷</div>
        <div className="pt">🇺🇾</div><div className="pt">🇨🇱</div><div className="pt">🇨🇴</div>
        <div className="pt">🇵🇪</div><div className="pt">🇯🇵</div><div className="pt">🇰🇷</div>
        <div className="pt">🇸🇦</div><div className="pt">🇮🇷</div><div className="pt">🇦🇪</div>
        <div className="pt">🇺🇿</div><div className="pt">🇮🇶</div><div className="pt">🇦🇺</div>
        <div className="pt">🇨🇲</div><div className="pt">🇰🇪</div><div className="pt">🇲🇦</div>
        <div className="pt">🇬🇭</div><div className="pt">🇦🇴</div><div className="pt">🇫🇷</div>
        <div className="pt">🇬🇧</div><div className="pt">🇩🇪</div><div className="pt">🇪🇸</div>
        <div className="pt">🇮🇹</div><div className="pt">🇳🇱</div><div className="pt">🇧🇪</div>
        <div className="pt">🇵🇹</div><div className="pt">🇦🇹</div><div className="pt">🇨🇭</div>
        <div className="pt">🇷🇸</div><div className="pt">🇭🇷</div><div className="pt">🇵🇱</div>
        <div className="pt">🇸🇪</div><div className="pt">🇷🇴</div><div className="pt">🇺🇦</div>
      </div>

      <div className="page" style={{ paddingBottom: '100px' }}>
        <header className="hero" style={{ paddingBottom: '0' }}>
          <h1 className="hero-title font-fifa-italic" style={{ fontSize: 'clamp(3.5rem, 8vw, 6rem)', lineHeight: '1.1' }}>
            FIFA FANTASY<br /><span className="glow-word">LEAGUE</span>
          </h1>
        </header>

        <div className="user-dash-top">
          {user ? (
                <div className="premium-glass-card" style={{ flex: 1, width: '100%', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', fontWeight: '800', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '4px' }}>Rank</span>
                      <span className="font-fifa" style={{ fontSize: '28px', color: '#fff', lineHeight: '1' }}>
                        {leaderboard.findIndex(p => p.user_profiles?.nickname === profile?.nickname) !== -1 
                          ? leaderboard.findIndex(p => p.user_profiles?.nickname === profile?.nickname) + 1 
                          : '-'}
                      </span>
                    </div>
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', overflow: 'hidden', flexShrink: '0', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                      {userTeam ? (
                        <img src={userTeam.logo_url} alt={userTeam.name} style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#fff' }} />
                      ) : (
                        <span style={{ fontSize: '11px', fontWeight: '800', color: 'rgba(255,255,255,0.5)' }}>YOU</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <p className="font-fifa" style={{ fontSize: '20px', color: '#fff', lineHeight: '1', letterSpacing: '0.05em', marginBottom: '4px' }}>
                        {profile?.nickname || 'Predictor'}
                      </p>
                      {profile?.wc_team_flair && (
                        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          {profile.wc_team_flair}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div className="font-fifa" style={{ fontSize: '32px', color: '#fff', lineHeight: '1', marginBottom: '4px' }}>
                      {leaderboard.find(p => p.user_profiles?.nickname === profile?.nickname)?.points || 0}
                    </div>
                    <p style={{ fontSize: '10px', fontWeight: '800', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.15em', lineHeight: '1' }}>
                      Points
                    </p>
                  </div>
                </div>
          ) : (
            <div className="lb-wrap" style={{ flex: 1, minWidth: '320px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '24px', textAlign: 'center', background: 'rgba(0, 0, 0, 0.8)' }}>
              <h3 className="font-fifa" style={{ fontSize: '24px', color: 'white', marginBottom: '8px' }}>LOGIN REQUIRED</h3>
              <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '14px', marginBottom: '16px' }}>You must log in to participate and submit predictions.</p>
              <button onClick={signInWithGoogle} style={{ background: 'var(--fifa-cyan)', color: '#000', border: 'none', padding: '10px 24px', borderRadius: '8px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 auto' }}>
                Sign in with Google
              </button>
            </div>
          )}
        </div>

        <div className="fifa-desktop-layout">
          <div className="fifa-main-content">
            <section className="section">
              
              {/* =======================
                  VIEW 1: AWARDS & HOME
                  ======================= */}
              {activeView === 'home' && (
                <div id="awards-home">
                  <div className="sh" style={{ marginBottom: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <h2 className="font-fifa-italic" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', color: 'white', lineHeight: '1.2', letterSpacing: '0.05em' }}>
                      TOURNAMENT <span style={{ color: 'var(--fifa-gold)' }}>AWARDS</span>
                    </h2>
                    <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontWeight: '500', marginTop: '12px', fontSize: '15px', maxWidth: '500px' }}>
                      Predict the award winners to unlock the group and knockout stages!
                    </p>
                  </div>

                  <div className="awards-container" style={{ marginBottom: '40px' }}>
                    {/* Golden Boot */}
                    <div className="award-card">
                      <div className="award-icon-area">
                        <span className="award-title font-fifa">GOLDEN BOOT</span>
                        <span className="award-subtitle">Top Scorer</span>
                      </div>
                      <div className="award-input-area">
                        {goldenBootId ? (
                          <div className="award-selected-player">
                            <span className="award-player-name">{goldenBoot}</span>
                            {!isAwardsLocked && (
                              <button className="award-clear-btn" onClick={() => { setGoldenBoot(''); setGoldenBootId(null); }}>✕</button>
                            )}
                          </div>
                        ) : (
                          <div style={{ pointerEvents: isAwardsLocked ? 'none' : 'auto', opacity: isAwardsLocked ? 0.5 : 1 }}>
                            <AutocompleteInput 
                              placeholder="Search for a player..." 
                              value={goldenBoot}
                              onChange={setGoldenBoot}
                              onSelect={(player) => { setGoldenBoot(player.name); setGoldenBootId(player.id); }}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Golden Glove */}
                    <div className="award-card">
                      <div className="award-icon-area">
                        <span className="award-title font-fifa">GOLDEN GLOVE</span>
                        <span className="award-subtitle">Best Goalkeeper</span>
                      </div>
                      <div className="award-input-area">
                        {goldenGloveId ? (
                          <div className="award-selected-player">
                            <span className="award-player-name">{goldenGlove}</span>
                            {!isAwardsLocked && (
                              <button className="award-clear-btn" onClick={() => { setGoldenGlove(''); setGoldenGloveId(null); }}>✕</button>
                            )}
                          </div>
                        ) : (
                          <div style={{ pointerEvents: isAwardsLocked ? 'none' : 'auto', opacity: isAwardsLocked ? 0.5 : 1 }}>
                            <AutocompleteInput 
                              placeholder="Search for a goalkeeper..." 
                              value={goldenGlove}
                              onChange={setGoldenGlove}
                              onSelect={(player) => { setGoldenGlove(player.name); setGoldenGloveId(player.id); }}
                              positionFilter="GK"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Golden Ball */}
                    <div className="award-card">
                      <div className="award-icon-area">
                        <span className="award-title font-fifa">GOLDEN BALL</span>
                        <span className="award-subtitle">Best Player</span>
                      </div>
                      <div className="award-input-area">
                        {goldenBallId ? (
                          <div className="award-selected-player">
                            <span className="award-player-name">{goldenBall}</span>
                            {!isAwardsLocked && (
                              <button className="award-clear-btn" onClick={() => { setGoldenBall(''); setGoldenBallId(null); }}>✕</button>
                            )}
                          </div>
                        ) : (
                          <div style={{ pointerEvents: isAwardsLocked ? 'none' : 'auto', opacity: isAwardsLocked ? 0.5 : 1 }}>
                            <AutocompleteInput 
                              placeholder="Search for a player..." 
                              value={goldenBall}
                              onChange={setGoldenBall}
                              onSelect={(player) => { setGoldenBall(player.name); setGoldenBallId(player.id); }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                    
                  {!hasSubmittedAwards ? (
                    <div className="submit-section">
                      <button className="submit-btn" onClick={handleSubmitAwards}>
                        SUBMIT AWARDS
                      </button>
                    </div>
                  ) : (
                    <div className="premium-glass-card" style={{ padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', maxWidth: '650px', margin: '0 auto 40px auto' }}>
                      <h3 className="font-fifa" style={{ color: 'var(--fifa-gold)', fontSize: '24px', textAlign: 'center', margin: 0 }}>BRACKETS UNLOCKED</h3>
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
                        
                        {!hasSubmittedGroups && (
                          <button className="premium-proceed-btn" onClick={() => setActiveView('groups')} style={{ flex: '1', minWidth: '200px' }}>
                            Predict Group Stage
                          </button>
                        )}

                        {hasSubmittedGroups && !hasKnockoutPrediction && (
                          <>
                            <button className="premium-proceed-btn" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', flex: '1', minWidth: '200px' }} onClick={() => setActiveView('groups')}>
                              View Group Stage Prediction Results
                            </button>
                            <button className="premium-proceed-btn" onClick={() => setActiveView('third_place')} style={{ flex: '1', minWidth: '200px' }}>
                              Proceed to Knockout
                            </button>
                          </>
                        )}

                        {hasSubmittedGroups && hasKnockoutPrediction && (
                          <>
                            <button className="premium-proceed-btn" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', flex: '1', minWidth: '200px' }} onClick={() => setActiveView('groups')}>
                              View Group Stage Prediction Results
                            </button>
                            <button className="premium-proceed-btn" onClick={goToKnockouts} style={{ flex: '1', minWidth: '200px' }}>
                              View Knockout Stage Prediction
                            </button>
                          </>
                        )}

                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* =======================
                  VIEW 2: GROUP STAGES
                  ======================= */}
              {activeView === 'groups' && (
                <div id="groups-view">
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '24px' }}>
                    <button onClick={() => viewingOtherUser ? handleBackToMyPredictions() : setActiveView('home')} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
                      ← {viewingOtherUser ? 'Back to Dashboard' : 'Collapse'}
                    </button>
                  </div>

                  <div className="sh" style={{ marginBottom: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <h2 className="font-fifa-italic" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', color: 'white', lineHeight: '1.2', letterSpacing: '0.05em' }}>
                      {viewingOtherUser ? (
                        <>VIEWING <span style={{ color: 'var(--fifa-gold)' }}>{viewingOtherUser.nickname.toUpperCase()}'S</span> PREDICTIONS</>
                      ) : (
                        <>PREDICT THE GROUP <span style={{ color: 'var(--fifa-gold)' }}>STAGES</span></>
                      )}
                    </h2>
                    <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontWeight: '500', marginTop: '12px', fontSize: '15px', maxWidth: '500px' }}>
                      {viewingOtherUser 
                        ? `These are the group stage standings predicted by ${viewingOtherUser.nickname}.`
                        : "Drag and position teams in each group to predict the group stage standings"}
                    </p>
                  </div>

                  {!viewingOtherUser && (
                    <div className="lb-wrap" style={{ width: '100%', maxWidth: '800px', margin: '0 auto 40px auto', background: 'rgba(0, 0, 0, 0.8)' }}>
                      <div className="lb-hdr" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', background: 'rgba(0, 0, 0, 0.2)', justifyContent: 'center', padding: '16px' }}>
                        <span className="lb-hdr-t font-fifa" style={{ fontSize: '20px' }}>HOW TO PLAY</span>
                      </div>
                      <div className="dash-rules" style={{ padding: '20px 24px' }}>
                        <div className="dash-rule-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', marginBottom: '20px' }}>
                          <div className="rule-badge" style={{ background: 'white', color: '#000' }}>STEP 1: TOURNAMENT AWARDS</div>
                          <div className="rule-text" style={{ fontSize: '12px', lineHeight: '1.5', color: 'rgba(255,255,255,0.8)' }}>
                            Start by predicting the overall tournament superstars to unlock the main brackets.
                          </div>
                        </div>
                        <div className="dash-rule-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', marginBottom: '20px' }}>
                          <div className="rule-badge" style={{ background: 'white', color: '#000' }}>STEP 2: GROUP STAGES</div>
                          <div className="rule-text" style={{ fontSize: '12px', lineHeight: '1.5', color: 'rgba(255,255,255,0.8)' }}>
                            Rank the four teams in each of the 12 groups. Select your best 3rd-place advancing teams to complete the Top 32.
                          </div>
                        </div>
                        <div className="dash-rule-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', marginBottom: '24px' }}>
                          <div className="rule-badge" style={{ background: 'white', color: '#000' }}>STEP 3: KNOCKOUT BRACKET</div>
                          <div className="rule-text" style={{ fontSize: '12px', lineHeight: '1.5', color: 'rgba(255,255,255,0.8)' }}>
                            Select the winner of each knockout matchup to advance them to the next round, continuing until you have chosen your champion.
                          </div>
                        </div>
                        <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.1)', marginBottom: '24px' }}></div>
                        <h4 style={{ color: 'white', fontSize: '14px', fontWeight: 'bold', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Scoring Rules</h4>
                        <div className="dash-rule-row">
                          <div className="rule-badge" style={{ background: 'var(--fifa-green)' }}>GROUP STAGES</div>
                          <div className="rule-text"><span className="rule-highlight">5 Points</span> for each team placed in their exact correct standing.</div>
                        </div>
                        <div className="dash-rule-row">
                          <div className="rule-badge" style={{ background: 'var(--fifa-gold)' }}>AWARDS</div>
                          <div className="rule-text"><span className="rule-highlight">100 Points</span> for predicting the Golden Boot, Glove, or Ball.</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!viewingOtherUser && isGroupsLocked && (
                    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                      <span className="font-fifa" style={{ color: 'var(--fifa-gold)', fontSize: '24px', letterSpacing: '2px' }}>PREDICTIONS LOCKED</span>
                      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '15px', marginTop: '8px' }}>You have already submitted your Group Stage predictions.</p>
                    </div>
                  )}

                  <div className="groups-container">
                    {Object.keys(viewingOtherUser ? otherUserStandings : groupStandings).map((groupName) => {
                      const activeStandings = viewingOtherUser ? otherUserStandings : groupStandings;
                      return (
                      <div className="group-card" key={groupName}>
                        <div className="group-header-row">
                          <div className="group-header">GROUP {groupName}</div>
                        </div>
                        <div className="group-list-container">
                          <div className="group-list" data-group={groupName}>
                            {activeStandings[groupName].map((team, idx) => {
                              const isAdvancing = idx < 2;
                              const slotKey = `${groupName}-${idx}`;
                              const isDraggingThis = draggingTeam && draggingTeam.group === groupName && draggingTeam.index === idx;
                              const positionText = ["1st", "2nd", "3rd", "4th"][idx];
                              
                              const officialGroup = officialStandings.groups[groupName];
                              const isGroupsLockedOrViewing = isGroupsLocked || viewingOtherUser;
                              const isCorrect = isGroupsLockedOrViewing && officialGroup && officialGroup[idx] && officialGroup[idx].team === team.name;
                              const isDraggingEnabled = !isGroupsLocked && !viewingOtherUser;

                              
                              return (
                                <div className="group-row" key={idx}>
                                  <div className="rank-label">{positionText}</div>
                                  <div
                                    className={`group-slot ${isAdvancing ? 'advancing' : 'eliminated'} ${dragOverSlot === slotKey ? 'drag-over' : ''} ${isCorrect ? 'correct-prediction' : ''}`}
                                    style={isCorrect ? { borderColor: '#00e676', backgroundColor: 'rgba(0, 230, 118, 0.45)' } : {}}
                                    data-position={idx + 1}
                                    onDragOver={(e) => handleDragOver(e, groupName, idx)}
                                    onDragLeave={handleDragLeave}
                                    onDrop={(e) => handleDrop(e, groupName, idx)}
                                  >
                                    <div
                                      className={`team-card ${isAdvancing ? '' : 'eliminated'} ${isDraggingThis ? 'dragging' : ''}`}
                                      draggable={isDraggingEnabled}
                                      onDragStart={(e) => handleDragStart(e, groupName, idx)}
                                      onDragEnd={handleDragEnd}
                                      data-team={team.name}
                                    >
                                      <div className="team-info" style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, paddingRight: '8px' }}>
                                        <img src={team.logo_url} alt={team.name} className="team-flag-img" style={{ flexShrink: 0 }} />
                                        <span className="team-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.name}</span>
                                      </div>
                                      {isDraggingEnabled && (
                                        <>
                                          <div className="mobile-move-controls" style={{ display: 'flex', flexDirection: 'column', marginRight: '4px', flexShrink: 0 }}>
                                            <button onClick={(e) => { e.preventDefault(); moveTeam(groupName, idx, -1); }} disabled={idx === 0} style={{ background: 'transparent', border: 'none', padding: '0px 8px', fontSize: '12px', color: idx === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.8)', cursor: idx === 0 ? 'default' : 'pointer' }}>▲</button>
                                            <button onClick={(e) => { e.preventDefault(); moveTeam(groupName, idx, 1); }} disabled={idx === 3} style={{ background: 'transparent', border: 'none', padding: '0px 8px', fontSize: '12px', color: idx === 3 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.8)', cursor: idx === 3 ? 'default' : 'pointer' }}>▼</button>
                                          </div>
                                          <div className="drag-handle" style={{ opacity: 0.5 }}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>

                  {!viewingOtherUser && !isGroupsLocked && (
                    <div className="submit-section" style={{ marginTop: '40px' }}>
                      <button className="submit-btn" onClick={handleSubmitGroups}>
                        SUBMIT GROUP STAGES
                      </button>
                    </div>
                  )}

                  {!viewingOtherUser && isGroupsLocked && (
                    <div className="submit-section" style={{ marginTop: '40px', display: 'flex', justifyContent: 'center' }}>
                      {!hasKnockoutPrediction ? (
                        <button className="premium-proceed-btn" onClick={() => setActiveView('third_place')}>
                          Proceed to Knockout
                        </button>
                      ) : (
                        <button className="premium-proceed-btn" onClick={goToKnockouts}>
                          View Knockout Stage Prediction
                        </button>
                      )}
                    </div>
                  )}

                  {viewingOtherUser && (
                    <div className="submit-section" style={{ marginTop: '40px', display: 'flex', justifyContent: 'center' }}>
                      <button className="premium-proceed-btn" onClick={() => setPredictionPhase('knockouts')}>
                        Show Knockout Predictions
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* =======================
                  VIEW 3: THIRD PLACE
                  ======================= */}
              {activeView === 'third_place' && (
                <div id="third-place-view">
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '24px' }}>
                    <button onClick={() => setActiveView('home')} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
                      ← Collapse
                    </button>
                  </div>

                  <div className="sh" style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <h2 className="font-fifa-italic" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', color: 'white', lineHeight: '1.2', letterSpacing: '0.05em' }}>
                      CHOOSE THE BEST THIRD PLACE <span style={{ color: 'var(--fifa-gold)' }}>TEAMS</span>
                    </h2>
                  </div>

                  {!hasSelectedThirdPlace ? (
                    <>
                      <div className="lb-wrap" style={{ width: '100%', maxWidth: '800px', margin: '0 auto 32px', background: 'rgba(0,0,0,0.5)' }}>
                        <div className="lb-hdr" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', background: 'rgba(0, 0, 0, 0.2)', justifyContent: 'center', padding: '16px' }}>
                          <span className="lb-hdr-t font-fifa" style={{ fontSize: '20px' }}>SCORING RULES</span>
                        </div>
                        <div className="dash-rules" style={{ padding: '20px 24px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>Correct 3rd Place Advancing:</span>
                              <span style={{ color: '#fff', fontSize: '14px' }}><span className="rule-highlight">5 points</span> each</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'center', width: '100%', padding: '0 16px' }}>
                        <div className="group-card" style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
                          <div style={{ padding: '16px 16px 0', textAlign: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                            <p style={{ color: 'rgba(255, 255, 255, 0.6)', fontWeight: '700', margin: '0 0 16px 0', fontSize: '14px', letterSpacing: '0.1em' }}>
                              {selectedThirdPlaceGroups.length}/8 SELECTED
                            </p>
                          </div>
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
                                      cursor: isDisabled ? 'not-allowed' : 'pointer', opacity: isDisabled ? 0.4 : 1, display: 'flex',
                                      alignItems: 'center', padding: '12px', background: isSelected ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255,255,255,0.05)',
                                      border: isSelected ? '2px solid #FFFFFF' : '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                                      boxShadow: isSelected ? '0 0 10px rgba(255,255,255,0.3)' : 'none'
                                    }}
                                  >
                                    <div className="team-info" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                                      <img src={team.logo_url} alt={team.name} className="team-flag-img" style={{ width: '32px', height: '32px', marginRight: '12px' }} />
                                      <span className="team-name">{team.name}</span>
                                    </div>
                                    {isSelected && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>}
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
                    </>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', width: '100%', padding: '0 16px' }}>
                      <div className="group-card" style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
                        <div className="group-list-container">
                          <div className="group-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', padding: '16px' }}>
                            {thirdPlaceTeams.filter(t => selectedThirdPlaceGroups.includes(t.group)).map(({ group, team }) => {
                              return (
                                <div key={group} className="team-card selected" style={{ display: 'flex', alignItems: 'center', padding: '12px', background: 'rgba(0, 0, 0, 0.6)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px' }}>
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
                  )}
                </div>
              )}

            </section>
          </div>
          
          {/* LEADERBOARD SIDEBAR */}
          <div className="fifa-side-content">
            <section className="section">
              <div className="sh">
                <div className="st font-fifa">
                  <div className="st-bar" style={{ '--bc': 'var(--fifa-gold)' }}></div>
                  Leaderboard
                </div>
              </div>
              <div className="lb-wrap" style={{ maxHeight: '600px', overflowY: 'auto', paddingRight: '10px' }}>
                <div className="lb-hdr">
                  <span className="lb-hdr-t font-fifa">Top Predictors</span>
                </div>
                {leaderboard.map((player, idx) => {
                  let rankColor = '#fff';
                  if (idx === 0) rankColor = 'var(--fifa-gold)';
                  else if (idx === 1) rankColor = '#c0c0c0';
                  else if (idx === 2) rankColor = '#cd7f32';

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
                      <div className="lb-sc" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                          <div className="lb-p font-fifa" style={{ color: rankColor }}>{player.points}</div>
                          <div className="lb-pl">pts</div>
                        </div>
                        {player.user_id && (
                          <button 
                            onClick={() => handleViewOtherUserPredictions(player.user_id, player.user_profiles?.nickname)}
                            title={`View ${player.user_profiles?.nickname}'s Predictions`}
                            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '6px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                        )}
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