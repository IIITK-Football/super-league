import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { API_BASE_URL } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { WomensBracket, FreshersBracket } from '../../pages/Standings';
import { DivisionSwitch } from './DivisionSwitch';
import { Button, Field, Notice } from '../ui';

const EMPTY = { home_team_id: '', away_team_id: '', date: '', venue: '', is_walkover: false, walkover_winner: '', walkover_reason: '' };

export default function ScheduleMatches() {
  const [division, setDivision] = useState('super-league');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null); // { tone, text }

  // Fetch teams specifically for the selected division!
  const { data: teamsResp } = useApi(`/teams?division=${division}`);
  const teams = teamsResp?.data || [];

  // Fetch the current standings/schedule data to display the bracket preview
  const { data: standingsResp } = useApi(`/standings?division=${division}`);
  const bracketMatches = standingsResp?.data?.bracketMatches || [];

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const validate = () => {
    const next = {};
    if (form.home_team_id && form.home_team_id === form.away_team_id) next.teams = 'A team cannot play against itself.';
    if (form.is_walkover && !form.walkover_reason.trim()) next.reason = 'Give a reason for the walkover.';
    if (form.is_walkover && !form.walkover_winner) next.winner = 'Choose which team is awarded the result.';
    return next;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    setNotice(null);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE_URL}/admin/matches`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ ...form, division })
      });
      if (res.ok) {
        setNotice({ tone: 'success', text: form.is_walkover ? 'Walkover registered.' : 'Match scheduled.' });
        setForm(EMPTY);
      } else {
        const errorData = await res.json().catch(() => ({}));
        setNotice({ tone: 'error', text: `Could not schedule the match: ${errorData.message || 'Unknown error'}` });
      }
    } catch (err) {
      setNotice({ tone: 'error', text: `Could not schedule the match: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const teamOptions = teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>);

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-center mb-8">
        <DivisionSwitch value={division} onChange={setDivision} />
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-2xl mx-auto">
        <h3 className="text-xl font-black uppercase tracking-widest text-white mb-6 text-center">Fixture generator</h3>

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field as="select" label="Home team" required value={form.home_team_id} onChange={(e) => set({ home_team_id: e.target.value })}>
              <option value="">Select home team</option>
              {teamOptions}
            </Field>
            <Field as="select" label="Away team" required value={form.away_team_id} onChange={(e) => set({ away_team_id: e.target.value })} error={errors.teams}>
              <option value="">Select away team</option>
              {teamOptions}
            </Field>
            <Field type="datetime-local" label="Kickoff" required value={form.date} onChange={(e) => set({ date: e.target.value })} />
            <Field label="Venue" required placeholder="e.g. Main turf" value={form.venue} onChange={(e) => set({ venue: e.target.value })} />
          </div>

          <div className="space-y-4 rounded-xl border border-white/10 p-4">
            <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-white">
              <input type="checkbox" checked={form.is_walkover} onChange={(e) => set({ is_walkover: e.target.checked, walkover_winner: e.target.checked ? form.walkover_winner : '' })} className="h-5 w-5 accent-white" />
              Register as walkover (3-0 win)
            </label>
            {form.is_walkover && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field as="select" label="Awarded to" required value={form.walkover_winner} error={errors.winner} onChange={(e) => set({ walkover_winner: e.target.value })}>
                  <option value="">Select the winner</option>
                  <option value="home">Home team</option>
                  <option value="away">Away team</option>
                </Field>
                <Field label="Reason" required hint="Shown on the result, for example no-show or ineligible player." error={errors.reason} value={form.walkover_reason} onChange={(e) => set({ walkover_reason: e.target.value })} />
              </div>
            )}
          </div>

          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

          <Button type="submit" disabled={loading} size="lg" className="w-full">
            {loading ? 'Saving...' : form.is_walkover ? 'Register walkover' : 'Schedule match'}
          </Button>
        </form>
      </div>

      {(division === 'wsl' || division === 'freshers') && (
        <div className="mt-16 pt-8 border-t border-white/10">
          <div className="text-center mb-8">
            <h3 className="text-sm font-black text-zinc-500 uppercase tracking-widest mb-2">Live preview</h3>
            <p className="text-xs text-zinc-400">This is how the bracket will look to the public based on the chronologically scheduled dates.</p>
          </div>
          <div className="opacity-90 scale-95 origin-top">
            {division === 'wsl' ? (
              <WomensBracket matches={bracketMatches} title="Bracket preview" buttonText="Current mapping of slots" />
            ) : (
              <FreshersBracket matches={bracketMatches} title="Bracket preview" buttonText="Current mapping of slots" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
