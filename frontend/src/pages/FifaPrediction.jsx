import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { createPortal } from 'react-dom';
import { AutocompleteInput } from '../components/AutocompleteInput';
import './FifaPrediction.css';

export function FifaPrediction() {
  const { user, profile, signInWithGoogle } = useAuth();
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


  const [draggingTeam, setDraggingTeam] = useState(null); // { group, index }
  const [dragOverSlot, setDragOverSlot] = useState(null); // "groupName-index"
  const [particles, setParticles] = useState([]);
  const [showHint, setShowHint] = useState(false);

  // Set page title and set up IntersectionObserver on mount
  useEffect(() => {
    document.title = "FIFA World Cup 2026 — Prediction Challenge";

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
  }, []);

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
      const groupRes = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          predictions: groupPredictions
        })
      });
      
      const awardsRes = await fetch(`${import.meta.env.VITE_API_URL}/wc/predictions/awards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          golden_boot_id: goldenBootId,
          golden_ball_id: goldenBallId,
          golden_glove_id: goldenGloveId
        })
      });

      if (!groupRes.ok || !awardsRes.ok) {
        throw new Error("Failed to save to database. It might be paused.");
      }

      console.log("Predictions Submitted to API!");
      alert("Predictions submitted successfully!");
    } catch (e) {
      console.error("API submission failed:", e);
      alert("Failed to submit to database. Saving locally instead. " + e.message);
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

        {/* Top Dash Sections */}
        <div className="user-dash-top">
          
          {/* Standings/Login Card */}
          {user ? (
                <div className="bg-black/30 border border-white/10 rounded-2xl py-10 flex items-center justify-center gap-8 sm:gap-16 shadow-lg backdrop-blur-md transition-all hover:bg-black/50" style={{ flex: 1, minWidth: '340px' }}>
                  <div className="flex items-center gap-5 sm:gap-6">
                    
                    {/* Rank */}
                    <div className="flex flex-col items-center justify-center mr-2">
                      <span className="text-zinc-500 text-[9px] font-bold tracking-widest uppercase mb-1">Rank</span>
                      <span className="text-2xl font-fifa text-white leading-none">{profile?.rank || '-'}</span>
                    </div>

                    {/* Avatar */}
                    <div className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 bg-white/5 flex items-center justify-center shadow-md">
                      {userTeam ? (
                        <img 
                          src={`https://flagcdn.com/48x36/${userTeam.code}.png`} 
                          alt={userTeam.name}
                          className="w-full h-full object-cover"
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
                      {profile?.points || 0}
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
                            className={`group-slot ${isAdvancing ? 'advancing' : 'eliminated'} ${
                              dragOverSlot === slotKey ? 'drag-over' : ''
                            }`}
                            data-position={idx + 1}
                            onDragOver={(e) => handleDragOver(e, groupName, idx)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, groupName, idx)}
                          >
                            <div
                              className={`team-card ${isAdvancing ? '' : 'eliminated'} ${
                                isDraggingThis ? 'dragging' : ''
                              }`}
                              draggable={true}
                              onDragStart={(e) => handleDragStart(e, groupName, idx)}
                              onDragEnd={handleDragEnd}
                              data-team={team.name}
                            >
                              <div className="team-info">
                                <img src={`https://flagcdn.com/48x36/${team.code}.png`} alt={team.name} className="team-flag-img" />
                                <span className="team-name">{team.name}</span>
                              </div>
                              <div className="drag-handle">
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
                  <div className="group-slot advancing">
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
                  <div className="group-slot advancing">
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
                  <div className="group-slot advancing">
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

          <div className="submit-section">
            <button className="submit-btn" id="submitBtn" onClick={handleSubmit}>
              Submit Predictions
            </button>
          </div>
        </section>

          </div>
          <div className="fifa-side-content">
            <section className="section reveal">
              <div className="sh">
                <div className="st font-fifa">
                  <div className="st-bar" style={{ '--bc': 'var(--fifa-gold)' }}></div>
                  Leaderboard
                </div>
              </div>
              <div className="lb-wrap">
                <div className="lb-hdr">
                  <span className="lb-hdr-t font-fifa">Top Predictors</span>
                </div>
            
            <div className="lb-row">
              <span className="lb-rk g font-fifa">1</span>
              <div className="lbav" style={{ color: 'var(--fifa-gold)', borderColor: 'var(--fifa-gold)' }}>
                RK
              </div>
              <div className="lb-inf">
                <div className="lb-nm">Rajan Kumar</div>
                <div className="lb-ct flex items-center gap-2">
                  <img src="https://flagcdn.com/24x18/mx.png" alt="Mexico" className="w-4 h-3 object-cover rounded-[2px]" />
                  Mexico
                </div>
              </div>
              <div className="lb-sc">
                <div className="lb-p font-fifa" style={{ color: 'var(--fifa-gold)' }}>2,840</div>
                <div className="lb-pl">pts</div>
              </div>
            </div>

            <div className="lb-row">
              <span className="lb-rk s font-fifa">2</span>
              <div className="lbav" style={{ color: '#c0c0c0', borderColor: '#c0c0c0' }}>
                ML
              </div>
              <div className="lb-inf">
                <div className="lb-nm">Maria Lopez</div>
                <div className="lb-ct flex items-center gap-2">
                  <img src="https://flagcdn.com/24x18/mx.png" alt="Mexico" className="w-4 h-3 object-cover rounded-[2px]" />
                  Mexico
                </div>
              </div>
              <div className="lb-sc">
                <div className="lb-p font-fifa" style={{ color: '#c0c0c0' }}>2,790</div>
                <div className="lb-pl">pts</div>
              </div>
            </div>

            <div className="lb-row">
              <span className="lb-rk b font-fifa">3</span>
              <div className="lbav" style={{ color: '#cd7f32', borderColor: '#cd7f32' }}>
                CW
              </div>
              <div className="lb-inf">
                <div className="lb-nm">Chen Wei</div>
                <div className="lb-ct flex items-center gap-2">
                  <img src="https://flagcdn.com/24x18/de.png" alt="Germany" className="w-4 h-3 object-cover rounded-[2px]" />
                  Germany
                </div>
              </div>
              <div className="lb-sc">
                <div className="lb-p font-fifa" style={{ color: '#cd7f32' }}>2,700</div>
                <div className="lb-pl">pts</div>
              </div>
            </div>

            <div className="lb-row" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '12px' }}>
              <span className="lb-rk font-fifa" style={{ color: '#fff' }}>{profile?.rank || '-'}</span>
              <div className="lbav overflow-hidden bg-white/5 border border-white/30" style={{ color: '#fff' }}>
                {userTeam ? (
                  <img src={`https://flagcdn.com/48x36/${userTeam.code}.png`} alt={userTeam.name} className="w-full h-full object-cover" />
                ) : (
                  'YOU'
                )}
              </div>
              <div className="lb-inf">
                <div className="lb-nm" style={{ fontWeight: '800' }}>{profile?.nickname || 'Your Position'}</div>
                <div className="lb-ct flex items-center gap-2 uppercase">
                  {userTeam ? (
                    <>
                      <img src={`https://flagcdn.com/24x18/${userTeam.code}.png`} alt={userTeam.name} className="w-4 h-3 object-cover rounded-[2px]" />
                      {profile.wc_team_flair}
                    </>
                  ) : (
                    '--'
                  )}
                </div>
              </div>
              <div className="lb-sc">
                <div className="lb-p font-fifa" style={{ color: '#fff' }}>{profile?.points || 0}</div>
                <div className="lb-pl">pts</div>
              </div>
            </div>

          </div>
        </section>
      </div>
    </div>
  </div>
</div>
  );
}
