import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLeague } from '../context/LeagueContext';
import { ArrowLeft, Loader2, Clock, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Loader } from './Loader';

export default function MatchTimeline() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [matchData, setMatchData] = useState(null);
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTimeline = async () => {
      const raw = sessionStorage.getItem('selectedMatch');
      // Default to returning to teams if something goes wrong
      if (!raw && !id) { navigate('/matches', { replace: true }); return; }
      const baseMatch = raw ? JSON.parse(raw) : { id };

      try {
        const { data: match } = await supabase
          .from('matches')
          .select('id, status, date, home_score, away_score, minute, home_team_id, away_team_id, home:teams!home_team_id(name), away:teams!away_team_id(name)')
          .eq('id', baseMatch.id)
          .single();

        const { data: rawGoals } = await supabase
          .from('goals')
          .select('*')
          .eq('match_id', baseMatch.id);

        const { data: players } = await supabase
          .from('players')
          .select('id, first_name, last_name, jersey_number, position');
        
        const mappedGoals = (rawGoals || []).map(g => {
          const scorer = players?.find(p => p.id === g.player_id);
          const assister = players?.find(p => p.id === g.assist_id);
          return {
            ...g,
            playerName: scorer ? `${scorer.first_name} ${scorer.last_name}` : 'Unknown',
            playerNumber: scorer?.jersey_number || '-',
            playerPosition: scorer?.position || 'PLY',
            assistName: assister ? `${assister.first_name} ${assister.last_name}` : null,
            assistNumber: assister?.jersey_number || '-'
          };
        });

        mappedGoals.sort((a, b) => parseInt(a.minute || 0) - parseInt(b.minute || 0));

        let currentHome = 0;
        let currentAway = 0;
        
        const goalsWithScore = mappedGoals.map(g => {
          const isHomeTeam = g.team_id === match.home_team_id;
          
          if (g.is_own_goal) {
            if (isHomeTeam) currentAway += 1;
            else currentHome += 1;
          } else {
            if (isHomeTeam) currentHome += 1;
            else currentAway += 1;
          }

          return { ...g, runningHome: currentHome, runningAway: currentAway };
        });

        setMatchData(match);
        setGoals(goalsWithScore);
      } catch (err) {
        console.error("Timeline Error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchTimeline();
  }, [id, navigate]);

  // SMART BACK BUTTON: Reads where the user came from, defaults to 'matches'
  const handleBack = () => {
    const source = sessionStorage.getItem('matchSource') || 'matches';
    navigate(source === 'teams' ? '/teams' : '/matches');
  };

  if (loading) {
    return <Loader text="Loading Match Data..." fullScreen />;
  }

  if (!matchData) return null;

  return (
    <div className="w-full bg-[#0F0E13] min-h-screen text-white p-4 md:p-8 font-sans pb-20 animate-in fade-in duration-300">
      
      <button onClick={handleBack} className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-8 group font-bold tracking-widest text-xs uppercase">
        <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
        Back
      </button>

      <div className="max-w-2xl mx-auto">
        
        {/* MATCH SCOREBOARD HEADER - ALIGNMENT FIXED */}
        <div className="bg-[#1A1820] rounded-3xl p-6 sm:p-12 flex flex-col items-center border border-white/5 mb-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#E8C881] to-transparent opacity-50" />
          
          <div className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-6 sm:mb-8 flex items-center gap-2">
            <Clock size={14} /> 
            {matchData.status === 'live' ? `LIVE • ${matchData.minute}'` : matchData.status}
          </div>

          <div className="flex items-center justify-center w-full gap-3 sm:gap-6">
            
            {/* Home Team (Flex-1 ensures it takes exact half space without crushing score) */}
            <div className="flex-1 flex justify-end">
              <h2 className="text-xl sm:text-3xl md:text-4xl font-black uppercase tracking-tighter text-right leading-none break-words">
                {matchData.home?.name}
              </h2>
            </div>
            
            {/* Fixed Score Box */}
            <div className="px-5 sm:px-8 py-3 sm:py-4 bg-black/80 rounded-2xl border border-white/10 text-3xl sm:text-5xl md:text-6xl font-black tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-500 shrink-0">
              {matchData.home_score} - {matchData.away_score}
            </div>

            {/* Away Team */}
            <div className="flex-1 flex justify-start">
              <h2 className="text-xl sm:text-3xl md:text-4xl font-black uppercase tracking-tighter text-left leading-none text-zinc-400 break-words">
                {matchData.away?.name}
              </h2>
            </div>

          </div>
        </div>

        {/* CARD-BASED EVENT FEED */}
        <div className="space-y-6 mt-12">
          {goals.length === 0 ? (
             <div className="bg-[#1A1820] rounded-2xl p-8 border border-white/5 text-center text-zinc-600 font-bold uppercase tracking-widest text-sm">
               No goals recorded yet.
             </div>
          ) : (
            <div className="flex flex-col gap-8">
              {goals.map((goal, idx) => {
                const isHome = goal.team_id === matchData.home_team_id;
                const teamName = isHome ? matchData.home?.name : matchData.away?.name;

                return (
                  <div key={goal.id || idx} className="rounded-xl overflow-hidden border border-white/10 shadow-2xl animate-fade-up">
                    
                    {/* Top Banner - Football & Goal Header */}
                    <div className="bg-zinc-800 text-white text-center py-4 flex flex-col items-center gap-1.5">
                      <span className="text-2xl drop-shadow-md">⚽</span>
                      <h4 className="text-lg sm:text-xl font-black uppercase tracking-widest text-zinc-100">
                        {goal.is_own_goal ? "OWN GOAL!!!" : "GOOOAAALLL!!!"}
                      </h4>
                      <span className="text-sm font-black text-zinc-400">{goal.minute}'</span>
                    </div>

                    {/* Middle Strip - Running Match Score */}
                    <div className="bg-zinc-700/80 text-white text-center py-2.5 text-xs sm:text-sm font-bold uppercase tracking-widest flex justify-center gap-4 items-center border-b border-white/5">
                      <span className="text-right w-1/3 truncate text-zinc-300">{matchData.home?.name}</span>
                      <span className="font-black tabular-nums tracking-wider bg-black/40 px-3 py-1 rounded">
                        {goal.runningHome} - {goal.runningAway}
                      </span>
                      <span className="text-left w-1/3 truncate text-zinc-300">{matchData.away?.name}</span>
                    </div>

                    {/* Bottom Details - Player Info */}
                    <div className="bg-[#1A1820] p-5 sm:p-6 flex items-center justify-between">
                      <div className="flex flex-col gap-1.5">
                        
                        <div className="flex items-center gap-2">
                          <h5 className="text-xl sm:text-2xl font-black uppercase text-white tracking-tight">
                            {goal.playerName}
                          </h5>
                          {goal.is_own_goal && (
                            <span className="text-[10px] bg-red-500/20 text-red-500 border border-red-500/20 px-1.5 py-0.5 rounded font-black uppercase tracking-widest">
                              OG
                            </span>
                          )}
                        </div>
                        
                        <p className="text-xs sm:text-sm font-bold text-zinc-400 uppercase tracking-widest">
                          {teamName} • {goal.playerPosition} #{goal.playerNumber}
                        </p>
                        
                        {goal.assistName && (
                          <p className="text-xs sm:text-sm font-bold text-zinc-500 uppercase tracking-widest mt-1">
                            Asst: <span className="text-zinc-300">{goal.assistName} #{goal.assistNumber}</span>
                          </p>
                        )}

                      </div>
                      
                      <Shield className="w-10 h-10 text-zinc-800 shrink-0 hidden sm:block" />
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
