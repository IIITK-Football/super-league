import React, { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useDivisions } from '../../hooks/useDivisions';
import { API_BASE_URL } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { WomensBracket, FreshersBracket } from '../../pages/Standings';
import { DivisionSwitch } from './DivisionSwitch';
import { Button, Card, ConfirmDialog, Field, Notice, Pill, Sheet, Table } from '../ui';
import { formatKickoff } from './adminFormat';

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
    setEditing({ id: m.id, home_team_id: m.home_team_id, away_team_id: m.away_team_id, date: '', venue: m.venue ?? '', kickoff: m.date });
  };

  // Date is optional when editing: blank keeps the stored kickoff.
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
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <DivisionSwitch value={division} onChange={(next) => { setDivision(next); setSeason(''); }} />
        <Field as="select" label="Season" value={season} onChange={(e) => setSeason(e.target.value)} className="sm:w-64">
          {seasons.length === 0 && <option value="">No seasons yet</option>}
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}
        </Field>
      </div>

      <Card className="max-w-2xl space-y-5">
        <div>
          <h2 className="font-display text-2xl font-bold text-ink">Schedule a match</h2>
          <p className="text-sm text-mut">Matches are created at 0-0. Results are entered on the live page.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

          <div className="space-y-4 rounded-card border border-line p-4">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
              <input type="checkbox" checked={form.is_walkover} onChange={(e) => set({ is_walkover: e.target.checked, walkover_winner: e.target.checked ? form.walkover_winner : '' })} className="size-5 accent-acc" />
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

          <Button type="submit" disabled={loading || !season} size="lg" className="w-full sm:w-auto">
            {loading ? 'Saving...' : form.is_walkover ? 'Register walkover' : 'Schedule match'}
          </Button>
        </form>
      </Card>

      <section className="space-y-3" aria-labelledby="fixtures-heading">
        <h2 id="fixtures-heading" className="font-display text-2xl font-bold text-ink">Fixtures</h2>
        {fixtures.length === 0 && <p className="text-sm text-mut">No fixtures in this season yet. Schedule the first match above.</p>}
        {fixtures.length > 0 && (
          <Table caption="Fixtures in this season">
            <thead>
              <tr><th scope="col">Kickoff</th><th scope="col">Fixture</th><th scope="col">Venue</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {fixtures.map((m) => (
                <tr key={m.id}>
                  <td className="text-mut">{formatKickoff(m.date) || 'Not set'}</td>
                  <td className="font-semibold">{m.home_team_name} vs {m.away_team_name}</td>
                  <td className="text-mut">{m.venue || 'No venue'}</td>
                  <td><Pill>{m.status}</Pill></td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button variant="quiet" size="sm" aria-label={`Edit ${m.home_team_name} vs ${m.away_team_name}`} onClick={() => openEdit(m)}>Edit</Button>
                      <Button variant="quiet" size="sm" aria-label={`Cancel ${m.home_team_name} vs ${m.away_team_name}`} onClick={() => setCancelTarget(m)} className="text-live">Cancel</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
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
            <Field type="datetime-local" label="Kickoff" hint={`Now: ${formatKickoff(editing.kickoff) || 'not set'}. Leave blank to keep it.`} value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            <Field label="Venue" value={editing.venue} onChange={(e) => setEditing({ ...editing, venue: e.target.value })} />
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
        <section className="space-y-3 border-t border-line pt-8">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Bracket preview</h2>
            <p className="text-sm text-mut">How the public bracket looks, from the scheduled dates.</p>
          </div>
          {division === 'wsl' ? (
            <WomensBracket matches={bracketMatches} title="Bracket preview" buttonText="Current mapping of slots" />
          ) : (
            <FreshersBracket matches={bracketMatches} title="Bracket preview" buttonText="Current mapping of slots" />
          )}
        </section>
      )}
    </div>
  );
}
