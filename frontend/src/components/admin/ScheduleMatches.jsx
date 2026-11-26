import React, { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useDivisions } from '../../hooks/useDivisions';
import { API_BASE_URL } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { WomensBracket, FreshersBracket } from '../../pages/Standings';
import { DivisionSwitch } from './DivisionSwitch';
import { Button, ConfirmDialog, Field, Notice, Sheet } from '../ui';

const EMPTY = { home_team_id: '', away_team_id: '', date: '', venue: '', is_walkover: false, walkover_winner: '', walkover_reason: '' };

// One request to the admin matches route, with the signed-in token. Returns the parsed body or throws its message.
async function matchesApi(method, query, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_BASE_URL}/admin/matches${query}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Unknown error');
  return data;
}

export default function ScheduleMatches() {
  const [division, setDivision] = useState('super-league');
  const [season, setSeason] = useState('');
  const [seasons, setSeasons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null); // { tone, text }
  const [editing, setEditing] = useState(null); // fixture being edited: { id, home_team_id, away_team_id, date, venue }
  const [editError, setEditError] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);

  const { divisions } = useDivisions();
  const divisionId = divisions.find((d) => d.slug === division)?.id;

  // The seasons of the selected division; the current one is the default.
  useEffect(() => {
    if (!divisionId) return undefined;
    let current = true;
    supabase.from('seasons').select('id, slug, name, is_current').eq('division_id', divisionId).order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (!current) return;
        const list = data || [];
        setSeasons(list);
        setSeason(list.find((x) => x.is_current)?.id ?? list[0]?.id ?? '');
      });
    return () => { current = false; };
  }, [divisionId]);

  const seasonQuery = season ? `&season=${season}` : '';
  // Fetch teams specifically for the selected division!
  const { data: teamsResp } = useApi(`/teams?division=${division}`);
  const teams = teamsResp?.data || [];

  // Every fixture of the season, scheduled or not, so a mistyped one can be corrected or cancelled.
  const { data: fixturesResp, refetch: refetchFixtures } = useApi(`/admin/matches?division=${division}${seasonQuery}`);
  const fixtures = fixturesResp?.data || [];

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
      await matchesApi('POST', '', { ...form, division, season });
      setNotice({ tone: 'success', text: form.is_walkover ? 'Walkover registered.' : 'Match scheduled.' });
      setForm(EMPTY);
      refetchFixtures();
    } catch (err) {
      setNotice({ tone: 'error', text: `Could not schedule the match: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (m) => {
    setEditError('');
    setEditing({ id: m.id, home_team_id: m.home_team_id, away_team_id: m.away_team_id, date: '', venue: '' });
  };

  // Date and venue are optional when editing: blank keeps the stored value (the list does not return them).
  const saveEdit = async (e) => {
    e.preventDefault();
    if (editing.home_team_id === editing.away_team_id) return setEditError('A team cannot play against itself.');
    setEditError('');
    try {
      await matchesApi('PUT', '', {
        id: editing.id,
        home_team_id: editing.home_team_id,
        away_team_id: editing.away_team_id,
        date: editing.date || undefined,
        venue: editing.venue.trim() || undefined,
      });
      setEditing(null);
      setNotice({ tone: 'success', text: 'Fixture updated.' });
      refetchFixtures();
    } catch (err) {
      setEditError(`Could not save the fixture: ${err.message}`);
    }
  };

  const cancelFixture = async () => {
    try {
      await matchesApi('DELETE', `?id=${cancelTarget.id}`);
      setNotice({ tone: 'success', text: 'Fixture cancelled.' });
      refetchFixtures();
    } catch (err) {
      throw new Error(`Could not cancel the fixture: ${err.message}`);
    }
  };

  const teamOptions = teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>);
  const bracketDivision = division === 'wsl' || division === 'freshers';

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-center">
        <DivisionSwitch value={division} onChange={(next) => { setDivision(next); setSeason(''); }} />
      </div>

      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Field as="select" label="Season" value={season} onChange={(e) => setSeason(e.target.value)}>
          {seasons.length === 0 && <option value="">No seasons yet</option>}
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}
        </Field>
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

          <Button type="submit" disabled={loading || !season} size="lg" className="w-full">
            {loading ? 'Saving...' : form.is_walkover ? 'Register walkover' : 'Schedule match'}
          </Button>
        </form>
      </div>

      <section className="mx-auto max-w-2xl space-y-3" aria-labelledby="fixtures-heading">
        <h3 id="fixtures-heading" className="text-sm font-black uppercase tracking-widest text-zinc-400">Fixtures</h3>
        {fixtures.length === 0 && <p className="text-sm text-zinc-500">No fixtures in this season yet.</p>}
        {fixtures.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/40 p-3">
            <span className="font-bold">{m.home_team_name} vs {m.away_team_name}</span>
            <div className="flex items-center gap-1">
              <span className="px-2 text-xs uppercase tracking-widest text-zinc-500">{m.status}</span>
              <button type="button" aria-label={`Edit ${m.home_team_name} vs ${m.away_team_name}`} onClick={() => openEdit(m)} className="min-h-11 px-3 text-xs font-black uppercase tracking-widest text-zinc-300 hover:text-white">Edit</button>
              <button type="button" aria-label={`Cancel ${m.home_team_name} vs ${m.away_team_name}`} onClick={() => setCancelTarget(m)} className="min-h-11 px-3 text-xs font-black uppercase tracking-widest text-red-400 hover:text-red-300">Cancel</button>
            </div>
          </div>
        ))}
      </section>

      <Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit fixture">
        {editing && (
          <form onSubmit={saveEdit} className="space-y-4">
            <Field as="select" label="Home team" value={editing.home_team_id} onChange={(e) => setEditing({ ...editing, home_team_id: e.target.value })}>
              {teamOptions}
            </Field>
            <Field as="select" label="Away team" value={editing.away_team_id} onChange={(e) => setEditing({ ...editing, away_team_id: e.target.value })} error={editError.startsWith('A team') ? editError : undefined}>
              {teamOptions}
            </Field>
            <Field type="datetime-local" label="Kickoff" hint="Leave blank to keep the current kickoff." value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            <Field label="Venue" hint="Leave blank to keep the current venue." value={editing.venue} onChange={(e) => setEditing({ ...editing, venue: e.target.value })} />
            {editError && !editError.startsWith('A team') && <Notice tone="error">{editError}</Notice>}
            <Button type="submit" size="lg" className="w-full">Save fixture</Button>
          </form>
        )}
      </Sheet>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title="Cancel this fixture?"
        description={cancelTarget ? `${cancelTarget.home_team_name} vs ${cancelTarget.away_team_name} is removed from the season. Matches with results cannot be removed.` : ''}
        confirmLabel="Cancel fixture"
        cancelLabel="Keep fixture"
        tone="danger"
        onConfirm={cancelFixture}
      />

      {bracketDivision && (
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
