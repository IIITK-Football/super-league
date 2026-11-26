import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { API_BASE_URL } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { DivisionSwitch } from './DivisionSwitch';
import { CheckCircle2, Target } from 'lucide-react';
import { Button, Crest, Pill, SegmentedControl, Skeleton, toast, useConfirm } from '../ui';
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
  const [view, setView] = useState('pending');
  const setNotice = (n) => n && toast({ tone: n.tone, title: n.text });

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
    <li key={m.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-3">
          <Crest name={m.home_team_name} size="sm" />
          <span className="min-w-0 truncate font-black uppercase tracking-tight text-ink">{m.home_team_name}</span>
          <span className="chrome shrink-0 font-display text-2xl tabular-nums text-ink">{m.home_score} - {m.away_score}</span>
          <span className="min-w-0 truncate font-black uppercase tracking-tight text-ink">{m.away_team_name}</span>
          <Crest name={m.away_team_name} size="sm" />
        </div>
        <p className="flex flex-wrap items-center gap-2 text-xs text-mut">
          <span>{formatKickoff(m.date) || 'Date not set'}</span>
          {isGraded && m.needs_regrade && <Pill tone="live">Needs regrade</Pill>}
        </p>
      </div>
      <Button variant={isGraded ? 'secondary' : 'primary'} size="sm" disabled={gradingId !== null} className="sm:min-w-40"
        onClick={() => handleGrade(m.id, `${m.home_team_name} vs ${m.away_team_name}`)}>
        {gradingId === m.id ? 'Processing...' : isGraded ? 'Regrade match' : 'Grade match'}
      </Button>
    </li>
  );
  const shown = view === 'pending' ? pendingMatches : gradedMatches;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <DivisionSwitch value={division} onChange={setDivision} />
        <Button variant="secondary" onClick={handleRegradeAll} disabled={isRegradingAll || !seasonId} className="text-live">
          {isRegradingAll ? 'Processing...' : 'Regrade season'}
        </Button>
      </div>

      {fetchLoading ? <Skeleton className="h-40 w-full rounded-card" />
        : matches.length === 0 ? <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-6 text-sm text-mut">
            <Target size={26} aria-hidden="true" />
            <p className="font-semibold text-ink">No completed matches yet</p>
            Matches appear here once they have a final result{seasonName ? '' : ' in the current season'}.
          </div>
          : <section aria-label="Completed matches" className="space-y-4">
            <SegmentedControl aria-label="Grading state" value={view} onChange={setView}
              options={[{ value: 'pending', label: `To grade (${pendingMatches.length})` }, { value: 'graded', label: `Graded (${gradedMatches.length})` }]} />
            {shown.length === 0
              ? <p className="flex items-center gap-2 text-sm text-mut"><CheckCircle2 size={16} aria-hidden="true" />{view === 'pending' ? 'Every completed match is graded.' : 'Nothing graded yet.'}</p>
              : <ul className="glass divide-y divide-line/70 rounded-card px-2">{shown.map((m) => matchRow(m, view === 'graded'))}</ul>}
          </section>}
    </div>
  );
}
