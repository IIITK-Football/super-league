import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { API_BASE_URL } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { DivisionSwitch } from './DivisionSwitch';
import { Button, Card, EmptyState, Notice, Pill, useConfirm } from '../ui';
import { formatKickoff } from './adminFormat';

// Grading works on one season: the completed matches of the division's current season (the list's scope). Regrading
// sends that season with the division, so it never touches another season's points.
export default function GradePredictions() {
  const [division, setDivision] = useState('super-league');
  const { data: resp, refetch, loading: fetchLoading } = useApi(`/admin/matches?status=completed&division=${division}`);
  const matches = resp?.data || [];
  const seasonId = matches[0]?.season_id;
  const seasonName = matches[0]?.season_name;
  const confirm = useConfirm();

  const [gradingId, setGradingId] = useState(null);
  const [isRegradingAll, setIsRegradingAll] = useState(false);
  const [notice, setNotice] = useState(null); // { tone, text }

  const handleRegradeAll = async () => {
    const ok = await confirm({
      title: `Regrade ${seasonName}?`,
      description: 'Recalculates points for every graded prediction in this season from its match events, then updates the season leaderboards. Other seasons are not changed.',
      confirmLabel: 'Regrade season',
      tone: 'danger',
    });
    if (!ok) return;

    setIsRegradingAll(true);
    setNotice(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE_URL}/admin/predictions/regrade-all?division=${division}&season=${seasonId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      const result = await res.json().catch(() => ({}));
      if (result.success) {
        setNotice({ tone: 'success', text: result.message });
        refetch();
      } else {
        setNotice({ tone: 'error', text: `Regrade failed: ${result.message || 'Unknown error'}` });
      }
    } catch (err) {
      setNotice({ tone: 'error', text: 'Regrade failed. Check your connection and try again.' });
    } finally {
      setIsRegradingAll(false);
    }
  };

  // Split matches into two categories
  const pendingMatches = matches.filter(m => !m.is_graded);
  const gradedMatches = matches.filter(m => m.is_graded);

  const handleGrade = async (matchId, matchName) => {
    const ok = await confirm({ title: `Grade predictions for ${matchName}?`, description: 'Points are worked out from the final result.', confirmLabel: 'Grade match' });
    if (!ok) return;

    setGradingId(matchId);
    setNotice(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const API_URL = API_BASE_URL;
      
      const res = await fetch(`${API_URL}/admin/predictions/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ match_id: matchId })
      });
      
      const result = await res.json().catch(() => ({}));
      if (result.success) {
        setNotice({ tone: 'success', text: result.message });
        refetch(); // Refresh the list so the match moves to the "Graded" section!
      } else {
        setNotice({ tone: 'error', text: `Grading failed: ${result.message || 'Unknown error'}` });
      }
    } catch (err) {
      setNotice({ tone: 'error', text: 'Grading failed. Check your connection and try again.' });
    } finally {
      setGradingId(null);
    }
  };

  // One completed match: its result, its grading state and the action.
  const matchRow = (m, isGraded) => (
    <Card key={m.id} className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-mut">
          <Pill tone={isGraded ? 'neutral' : 'acc'}>{isGraded ? 'Graded' : 'To grade'}</Pill>
          {isGraded && m.needs_regrade && <Pill tone="live">Needs regrade</Pill>}
          <span>{formatKickoff(m.date) || 'Date not set'}</span>
        </div>
        <p className="font-semibold text-ink">
          {m.home_team_name} <span className="font-display tabular-nums text-ink">{m.home_score} – {m.away_score}</span> {m.away_team_name}
        </p>
      </div>
      <Button variant={isGraded ? 'secondary' : 'primary'} disabled={gradingId !== null} className="md:min-w-44"
        onClick={() => handleGrade(m.id, `${m.home_team_name} vs ${m.away_team_name}`)}>
        {gradingId === m.id ? 'Processing...' : isGraded ? 'Regrade match' : 'Grade match'}
      </Button>
    </Card>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <DivisionSwitch value={division} onChange={setDivision} />
      </div>

      <section aria-labelledby="grading-heading" className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 id="grading-heading" className="font-display text-2xl font-black uppercase tracking-tight text-ink">Grade fantasy predictions</h2>
            <p className="text-sm text-mut">Work out points for completed matches. Grading uses the current season only.</p>
          </div>
          <Button variant="secondary" onClick={handleRegradeAll} disabled={isRegradingAll || !seasonId} className="text-live">
            {isRegradingAll ? 'Processing...' : 'Regrade season'}
          </Button>
        </div>

        {notice && <Notice tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</Notice>}
        {fetchLoading ? <p className="text-sm text-mut">Loading completed matches...</p>
          : matches.length === 0 ? <EmptyState title="No completed matches yet">Matches appear here once they have a final result.</EmptyState>
            : <div className="space-y-8">
              <div className="space-y-3">
                <h3 className="font-display text-xl font-black uppercase tracking-tight text-ink">To grade ({pendingMatches.length})</h3>
                {pendingMatches.length === 0 ? <p className="text-sm text-mut">Every completed match is graded.</p>
                  : <div className="space-y-3">{pendingMatches.map((m) => matchRow(m, false))}</div>}
              </div>
              {gradedMatches.length > 0 && <div className="space-y-3">
                <h3 className="font-display text-xl font-black uppercase tracking-tight text-ink">Graded ({gradedMatches.length})</h3>
                <div className="space-y-3">{gradedMatches.map((m) => matchRow(m, true))}</div>
              </div>}
            </div>}
      </section>
    </div>
  );
}
