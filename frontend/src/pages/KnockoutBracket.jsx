import React, { useState, useEffect, useRef } from 'react';
import { MatchNode } from '../components/bracket/MatchNode';
import { generateRoundOf32, generateEmptyKnockouts } from '../utils/fifaBracketLogic';
import './KnockoutBracket.css';
import { useAuth } from '../context/AuthContext';

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

export function KnockoutBracket({ onBack }) {
  const { user } = useAuth();
  const headerRef = useRef(null);

  useEffect(() => {
    document.body.classList.add('knockout-mode');
    return () => {
      document.body.classList.remove('knockout-mode');
    };
  }, []);
  
  const [bracketState, setBracketState] = useState(null);
  const [showFireworks, setShowFireworks] = useState(false);
  const [svgLines, setSvgLines] = useState([]);

  // Function to calculate line coordinates
  const calculateLines = () => {
    const lines = [];
    if (!bracketState) return;

    // Find the wrapper to get relative coordinates
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

    // Iterate through all matches that have a nextMatchId
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
        // Determine if this match is the top feeder or bottom feeder
        const feeders = allMatches.filter(m => m.nextMatchId === match.nextMatchId)
                                  .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        const isTopFeeder = feeders[0]?.id === match.id;

        const from = getCenter(el);
        const toMatch = getCenter(nextEl);

        // Find the specific team slot element within the next match node
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

  // Run calculation on load and window resize
  useEffect(() => {
    calculateLines();
    window.addEventListener('resize', calculateLines);
    return () => window.removeEventListener('resize', calculateLines);
  }, [bracketState]);

  useEffect(() => {
    // Load data from localStorage
    try {
      const savedGroups = localStorage.getItem('groupPredictions');
      const savedThirds = localStorage.getItem('selectedThirdPlace');
      
      // Load any existing knockout progress
      const savedKnockouts = localStorage.getItem('knockoutPredictions');

      if (!savedGroups || !savedThirds) {
        // Redirect to main prediction page if they haven't finished previous steps
        if (onBack) onBack();
        return;
      }

      if (savedKnockouts) {
        setBracketState(JSON.parse(savedKnockouts));
      } else {
        // Initialize bracket
        const groupStandings = JSON.parse(savedGroups);
        const selectedThirdGroups = JSON.parse(savedThirds);

        // We need the full team objects in groupStandings
        // Wait, groupPredictions in localStorage currently saves {position, team: string}
        // Actually, in FifaPrediction.jsx, we save legacyPredictions which is just {position, team}
        // Let's see how FifaPrediction loads it... we might need to fetch the teams again
        // Or if the full object is saved, we use it. For now, we will fetch /wc/teams to map them.
        
        const fetchTeamsAndInitialize = async () => {
          const res = await fetch(`${import.meta.env.VITE_API_URL}/wc/teams`);
          const json = await res.json();
          const fetchedGroups = {};
          
          if (json.success) {
            json.data.forEach(t => {
              const gLetter = t.group_name.replace('Group ', '');
              if (!fetchedGroups[gLetter]) fetchedGroups[gLetter] = [];
              fetchedGroups[gLetter].push({ id: t.id, name: t.name, logo_url: t.logo_url, group: gLetter });
            });
            
            // map standings
            const fullStandings = {};
            Object.keys(groupStandings).forEach(group => {
              fullStandings[group] = groupStandings[group].map(item => {
                const teamName = typeof item.team === 'string' ? item.team : (item.name || '');
                const found = fetchedGroups[group].find(t => t.name === teamName);
                return found || { name: teamName };
              });
            });

            const r32Matches = generateRoundOf32(fullStandings, selectedThirdGroups);
            const emptyKnockouts = generateEmptyKnockouts();

            setBracketState({
              roundOf32: r32Matches,
              roundOf16: emptyKnockouts.roundOf16,
              quarterFinals: emptyKnockouts.quarterFinals,
              semiFinals: emptyKnockouts.semiFinals,
              final: emptyKnockouts.final
            });
          }
        };

        fetchTeamsAndInitialize();
      }
    } catch (e) {
      console.error(e);
      if (onBack) onBack();
    }
  }, [onBack]);

  const handleSelectWinner = (matchId, winnerTeam) => {
    // Trigger fireworks if the final match is selected
    if (bracketState.final.some(m => m.id === matchId)) {
      setShowFireworks(true);
      setTimeout(() => setShowFireworks(false), 4000);
    }

    setBracketState(prev => {
      const newState = { ...prev };
      let matchFound = null;
      let currentRound = null;

      // Find the match and update its winner
      Object.keys(newState).forEach(roundKey => {
        const m = newState[roundKey].find(m => m.id === matchId);
        if (m) {
          m.winnerId = winnerTeam.id;
          matchFound = m;
          currentRound = roundKey;
        }
      });

      if (!matchFound || !matchFound.nextMatchId) return newState;

      // Propagate the winner to the next match
      Object.keys(newState).forEach(roundKey => {
        const nextMatch = newState[roundKey].find(m => m.id === matchFound.nextMatchId);
        if (nextMatch) {
          // If we changed a previous prediction, we might need to clear subsequent winners
          // For now, just slot them into the next available empty spot or overwrite
          // Determining which slot (team1 or team2) is tricky without a direct mapping
          // Let's assume matches progress sequentially. The previous round has 2x matches.
          // Example: m17 is fed by m1 and m2.
          // We can check if team1 is already from this sub-branch or empty
          
          // Simple logic: if team1 is empty or was previously the old winner of matchFound, replace team1.
          // Better logic: each nextMatch has 2 feeders. The feeder with lower ID goes to team1, higher to team2.
          const currentRoundMatches = newState[currentRound];
          const feeders = currentRoundMatches.filter(m => m.nextMatchId === nextMatch.id).sort((a,b) => a.id.localeCompare(b.id, undefined, {numeric: true}));
          
          if (feeders[0]?.id === matchFound.id) {
            nextMatch.team1 = winnerTeam;
            // Clear future winner if this changed
            if (nextMatch.winnerId) nextMatch.winnerId = null;
          } else if (feeders[1]?.id === matchFound.id) {
            nextMatch.team2 = winnerTeam;
            if (nextMatch.winnerId) nextMatch.winnerId = null;
          }
        }
      });

      // Save progress to localstorage
      localStorage.setItem('knockoutPredictions', JSON.stringify(newState));

      return newState;
    });
  };

  const handleScroll = (e) => {
    if (headerRef.current) {
      headerRef.current.style.transform = `translateX(-${e.target.scrollLeft}px)`;
    }
  };

  const submitKnockouts = async () => {
    // Check if final has a winner
    if (!bracketState.final[0].winnerId) {
      alert("Please complete the entire bracket before submitting!");
      return;
    }
    alert("Bracket Predictions Submitted Successfully! (Mock)");
    if (onBack) onBack();
  };

  if (!bracketState) {
    return (
      <div className="kb-page">
        <div className="bg-canvas"><div className="bg-ballgrid"></div></div>
        <div className="kb-loading font-fifa">Loading Bracket...</div>
      </div>
    );
  }

  return (
    <div className="kb-page">
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

      <header className="kb-header">
        <h1 className="font-fifa-italic">KNOCKOUT <span style={{color: 'var(--fifa-gold)'}}>BRACKET</span></h1>
      </header>

      <div className="kb-header-wrapper" style={{ position: 'sticky', top: 0, zIndex: 50, overflow: 'hidden', background: 'var(--fifa-blue)', boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)' }}>
        <div className="kb-rounds-header font-fifa" ref={headerRef} style={{ width: 'max-content' }}>
          <div className="kb-round-header-item">R32</div>
          <div className="kb-round-header-item">R16</div>
          <div className="kb-round-header-item">QF</div>
          <div className="kb-round-header-item">SF</div>
          <div className="kb-round-header-item">FINAL</div>
        </div>
      </div>

      <div className="kb-scroll-container" onScroll={handleScroll}>
        <div style={{ display: 'flex', flexDirection: 'column', width: 'max-content' }}>


          <div className="kb-bracket-wrapper">
            {/* SVG Overlay for Dynamic Lines */}
            <svg 
              className="kb-svg-overlay" 
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
            >
              {svgLines.map(line => (
                <path 
                  key={line.id} 
                  d={line.path} 
                  fill="none" 
                  stroke="rgba(255, 255, 255, 0.8)" 
                  strokeWidth="2" 
                  strokeLinejoin="round"
                />
              ))}
            </svg>

            {/* Round of 32 */}
            <div className="kb-round">
              <div className="kb-match-list r32">
                {bracketState.roundOf32.map(m => (
                  <div className="kb-match-wrapper" key={m.id} data-match-id={m.id}>
                    <MatchNode match={m} onSelectWinner={handleSelectWinner} />
                  </div>
                ))}
              </div>
            </div>

          {/* Round of 16 */}
          <div className="kb-round">
            <div className="kb-match-list r16">
              {bracketState.roundOf16.map(m => (
                <div className="kb-match-wrapper" key={m.id} data-match-id={m.id}>
                  <MatchNode match={m} onSelectWinner={handleSelectWinner} />
                </div>
              ))}
            </div>
          </div>

          {/* Quarter Finals */}
          <div className="kb-round">
            <div className="kb-match-list qf">
              {bracketState.quarterFinals.map(m => (
                <div className="kb-match-wrapper" key={m.id} data-match-id={m.id}>
                  <MatchNode match={m} onSelectWinner={handleSelectWinner} />
                </div>
              ))}
            </div>
          </div>

          {/* Semi Finals */}
          <div className="kb-round">
            <div className="kb-match-list sf">
              {bracketState.semiFinals.map(m => (
                <div className="kb-match-wrapper" key={m.id} data-match-id={m.id}>
                  <MatchNode match={m} onSelectWinner={handleSelectWinner} />
                </div>
              ))}
            </div>
          </div>

          {/* Final */}
          <div className="kb-round final-round">
            <div className="kb-match-list final" style={{ position: 'relative' }}>
              {/* Champion Display */}
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
                            {/* Simple CSS confetti particles */}
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
                  <MatchNode match={m} onSelectWinner={handleSelectWinner} isFinal={true} />
                </div>
              ))}
              
              <button className="kb-submit-btn white-btn" onClick={submitKnockouts} style={{ marginTop: '24px', padding: '12px', fontSize: '16px', width: '100%' }}>
                Submit
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
