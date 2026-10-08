import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { API_BASE_URL } from '../../lib/api';
import { Calculator, Loader2, CheckCircle2, RefreshCw, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function GradePredictions() {
  const [division, setDivision] = useState('mens');
  const { data: resp, refetch, loading: fetchLoading } = useApi(`/admin/matches?status=completed&division=${division}`);
  const matches = resp?.data || [];
  
  const [gradingId, setGradingId] = useState(null);
  const [isRegradingAll, setIsRegradingAll] = useState(false);

  const handleRegradeAll = async () => {
    if (!confirm("⚠️ WARNING: This will re-calculate points for EVERY prediction in the database and synchronize the leaderboard. This operation may take a few seconds. Do you want to proceed?")) return;
    
    setIsRegradingAll(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const API_URL = API_BASE_URL;
      
      const res = await fetch(`${API_URL}/admin/predictions/regrade-all`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      
      const result = await res.json();
      if (result.success) {
        alert("✅ " + result.message);
        refetch();
      } else {
        alert("❌ Error: " + result.message);
      }
    } catch (err) {
      console.error(err);
      alert("Mass regrade failed. Check console.");
    } finally {
      setIsRegradingAll(false);
    }
  };

  // Split matches into two categories
  const pendingMatches = matches.filter(m => !m.is_graded);
  const gradedMatches = matches.filter(m => m.is_graded);

  const handleGrade = async (matchId, matchName) => {
    if (!confirm(`Are you sure you want to grade predictions for ${matchName}?`)) return;
    
    setGradingId(matchId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const API_URL = API_BASE_URL;
      
      const res = await fetch(`${API_URL}/admin/predictions/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ match_id: matchId })
      });
      
      const result = await res.json();
      if (result.success) {
        alert("✅ " + result.message);
        refetch(); // Refresh the list so the match moves to the "Graded" section!
      } else {
        alert("❌ Error: " + result.message);
      }
    } catch (err) {
      console.error(err);
      alert("Grading failed. Check console.");
    } finally {
      setGradingId(null);
    }
  };

  // Reusable Match Row Component
  const MatchRow = ({ m, isGraded }) => (
    <div className={`border rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${isGraded ? 'bg-black/20 border-white/5 opacity-70' : 'bg-black/50 border-white/10 hover:bg-white/5'}`}>
      <div>
        <div className="flex items-center gap-3 mb-1">
          <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-black tracking-widest ${isGraded ? 'bg-zinc-500/20 text-zinc-400' : 'bg-green-500/20 text-green-400'}`}>
            {isGraded ? 'Graded' : 'Action Required'}
          </span>
          {/* Fixed the Invalid Date bug here! */}
          <span className="text-xs text-zinc-500 font-mono">
            {m.date ? new Date(m.date).toLocaleDateString() : 'Date TBD'}
          </span>
        </div>
        <h3 className="text-lg font-black text-white">
          {m.home_team_name} <span className={isGraded ? "text-zinc-500 mx-1" : "text-[#E8C881] mx-1"}>{m.home_score} - {m.away_score}</span> {m.away_team_name}
        </h3>
      </div>

      <button 
        onClick={() => handleGrade(m.id, `${m.home_team_name} vs ${m.away_team_name}`)}
        disabled={gradingId !== null}
        className={`flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-black uppercase tracking-widest text-xs transition-colors disabled:opacity-50 min-w-[180px] ${
          isGraded 
            ? 'bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10' 
            : 'bg-[#E8C881] hover:bg-[#F9D992] text-black'
        }`}
      >
        {gradingId === m.id ? (
          <><Loader2 size={16} className="animate-spin" /> Processing...</>
        ) : isGraded ? (
          <><RefreshCw size={16} /> Re-Grade</>
        ) : (
          <><Calculator size={16} /> Grade Match</>
        )}
      </button>
    </div>
  );

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-500 pb-20">
      
      <div className="flex justify-center mb-4">
        <div className="bg-black/50 p-1 rounded-full border border-white/10 flex">
          <button onClick={() => setDivision('mens')} className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${division === 'mens' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Men's</button>
          <button onClick={() => setDivision('womens')} className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${division === 'womens' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Women's</button>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-8 border-b border-white/10 pb-4">
          <Calculator className="text-[#E8C881]" size={24} />
          <div className="flex-1">
            <h2 className="text-xl font-black uppercase tracking-widest text-white">Grade Fantasy Predictions</h2>
            <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest mt-1">Run point calculations for completed matches</p>
          </div>
          <button
            onClick={handleRegradeAll}
            disabled={isRegradingAll}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
          >
            {isRegradingAll ? (
              <><Loader2 size={14} className="animate-spin" /> Processing...</>
            ) : (
              <><AlertTriangle size={14} /> Regrade All Scores</>
            )}
          </button>
        </div>

        {fetchLoading ? (
           <div className="flex justify-center py-10"><Loader2 className="animate-spin text-zinc-500" /></div>
        ) : matches.length === 0 ? (
          <div className="text-center py-12 border border-white/5 rounded-2xl bg-black/40">
            <span className="text-zinc-500 font-bold uppercase tracking-widest text-sm">No completed matches found.</span>
          </div>
        ) : (
          <div className="space-y-10">
            
            {/* Section 1: Pending */}
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                Pending Grades ({pendingMatches.length})
              </h3>
              {pendingMatches.length === 0 ? (
                <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest border border-dashed border-white/5 p-4 rounded-xl text-center">All caught up!</p>
              ) : (
                <div className="space-y-4">
                  {pendingMatches.map(m => <MatchRow key={m.id} m={m} isGraded={false} />)}
                </div>
              )}
            </div>

            {/* Section 2: Already Graded */}
            {gradedMatches.length > 0 && (
              <div>
                <h3 className="text-sm font-black text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-green-500" />
                  Already Graded ({gradedMatches.length})
                </h3>
                <div className="space-y-4">
                  {gradedMatches.map(m => <MatchRow key={m.id} m={m} isGraded={true} />)}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
