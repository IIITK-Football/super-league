import { useEffect, useState } from 'react';
import { CalendarPlus, MapPin, Pencil, X } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useDivisions } from '../../hooks/useDivisions';
import { API_BASE_URL } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { WomensBracket, FreshersBracket } from '../../pages/Standings';
import { DivisionSwitch } from './DivisionSwitch';
import { Button, Combobox, ConfirmDialog, Crest, DateTimeField, Field, Notice, Pill, SegmentedControl, Select, Sheet, Switch, TextInput, toast } from '../ui';
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
      toast({ tone: 'success', title: form.is_walkover ? 'Walkover registered.' : 'Match scheduled.' });
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
      toast({ tone: 'success', title: 'Fixture updated.' });
      refetchFixtures();
    } catch (err) {
      setEditError(`Could not save the fixture: ${err.message}`);
    }
  };

  const cancelFixture = async () => {
    try {
      await matchesApi('DELETE', `?id=${cancelTarget.id}`);
      toast({ tone: 'success', title: 'Fixture cancelled.' });
      refetchFixtures();
    } catch (err) {
      throw new Error(`Could not cancel the fixture: ${err.message}`);
    }
  };

  const crestOf = (id) => { const t = teams.find((x) => x.id === id); return t ? <Crest name={t.name} src={t.logo_url} color={t.team_color} size="sm" /> : null; };
  const teamOptions = teams.map((t) => ({ value: t.id, label: t.name, icon: crestOf(t.id) }));
  const bracketDivision = division === 'wsl' || division === 'freshers';
  const teamPicker = (label, value, onChange, extra = {}) => (
    <Field label={label} error={extra.error}>{(p) => <Combobox {...p} aria-label={label} value={value} onChange={onChange}
      placeholder={extra.placeholder ?? 'Choose a team'} searchPlaceholder="Search teams" options={teamOptions} />}</Field>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <DivisionSwitch value={division} onChange={(next) => { setDivision(next); setSeason(''); }} />
        <Field label="Season" className="lg:w-64">{(p) => <Select {...p} aria-label="Season" value={season} onChange={setSeason}
          placeholder="No seasons yet" options={seasons.map((x) => ({ value: x.id, label: `${x.name}${x.is_current ? ' (current)' : ''}` }))} />}</Field>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:items-start">
        <section id="add-fixture" aria-labelledby="add-fixture-heading" className="glass scroll-mt-28 space-y-5 rounded-card p-5">
          <div className="space-y-1">
            <h2 id="add-fixture-heading" className="font-display text-2xl text-ink">Schedule a match</h2>
            <p className="text-sm text-mut">Matches start at 0-0. Results are entered on the live desk.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
              {teamPicker('Home team', form.home_team_id, (id) => set({ home_team_id: id }), { placeholder: 'Select home team' })}
              {teamPicker('Away team', form.away_team_id, (id) => set({ away_team_id: id }), { placeholder: 'Select away team', error: errors.teams })}
              <Field label="Kickoff">{(p) => <DateTimeField {...p} type="datetime-local" required value={form.date} onChange={(e) => set({ date: e.target.value })} />}</Field>
              <Field label="Venue">{(p) => <TextInput {...p} icon={MapPin} required placeholder="e.g. Main turf" value={form.venue} onChange={(e) => set({ venue: e.target.value })} />}</Field>
            </div>

            <div className="space-y-4 rounded-ctl border border-line p-4">
              <Switch label="Register as walkover (3-0 win)" checked={form.is_walkover} onChange={(on) => set({ is_walkover: on, walkover_winner: on ? form.walkover_winner : '' })} />
              {form.is_walkover && (
                <div className="grid grid-cols-1 gap-4">
                  <Field label="Awarded to" error={errors.winner}>{(p) => <SegmentedControl aria-labelledby={p['aria-labelledby']} value={form.walkover_winner} onChange={(v) => set({ walkover_winner: v })}
                    options={[{ value: 'home', label: 'Home team' }, { value: 'away', label: 'Away team' }]} />}</Field>
                  <Field label="Reason" required hint="Shown on the result, for example no-show or ineligible player." error={errors.reason} value={form.walkover_reason} onChange={(e) => set({ walkover_reason: e.target.value })} />
                </div>
              )}
            </div>

            {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

            <Button type="submit" disabled={loading || !season} size="lg" className="w-full">
              <CalendarPlus size={17} aria-hidden="true" />{loading ? 'Saving...' : form.is_walkover ? 'Register walkover' : 'Schedule match'}
            </Button>
          </form>
        </section>

        <section className="space-y-3" aria-labelledby="fixtures-heading">
          <h2 id="fixtures-heading" className="eyebrow">Fixtures in this season</h2>
          {fixtures.length === 0 && <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-6 text-sm text-mut">
            <CalendarPlus size={26} aria-hidden="true" />
            <p className="font-semibold text-ink">No fixtures in this season yet</p>
            Schedule the first match with the form.
          </div>}
          {fixtures.length > 0 && (
            <ul aria-label="Fixtures" className="glass divide-y divide-line/70 rounded-card px-2">
              {fixtures.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
                  <div className="w-24 shrink-0 text-xs tabular-nums text-mut">{formatKickoff(m.date) || 'Not set'}</div>
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    {crestOf(m.home_team_id)}
                    <span className="min-w-0 truncate text-sm font-black uppercase tracking-tight text-ink">{m.home_team_name} vs {m.away_team_name}</span>
                    {crestOf(m.away_team_id)}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-mut">
                    {m.status === 'live' && <Pill tone="live">Live</Pill>}
                    {m.status === 'completed' && <span className="font-display text-sm tabular-nums text-ink">{m.home_score} - {m.away_score}</span>}
                    <span className="hidden items-center gap-1 md:inline-flex"><MapPin size={13} aria-hidden="true" />{m.venue || 'No venue'}</span>
                  </div>
                  <div className="ml-auto flex shrink-0">
                    <Button variant="quiet" size="sm" className="px-3" aria-label={`Edit ${m.home_team_name} vs ${m.away_team_name}`} onClick={() => openEdit(m)}><Pencil size={15} aria-hidden="true" /></Button>
                    <Button variant="quiet" size="sm" className="px-3 text-live" aria-label={`Cancel ${m.home_team_name} vs ${m.away_team_name}`} onClick={() => setCancelTarget(m)}><X size={16} aria-hidden="true" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit fixture">
        {editing && (
          <form onSubmit={saveEdit} className="space-y-4">
            {teamPicker('Home team', editing.home_team_id, (id) => setEditing({ ...editing, home_team_id: id }))}
            {teamPicker('Away team', editing.away_team_id, (id) => setEditing({ ...editing, away_team_id: id }), { error: editError.startsWith('A team') ? editError : undefined })}
            <Field label="Kickoff" hint={`Now: ${formatKickoff(editing.kickoff) || 'not set'}. Leave blank to keep it.`}>{(p) => <DateTimeField {...p} type="datetime-local" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />}</Field>
            <Field label="Venue">{(p) => <TextInput {...p} icon={MapPin} value={editing.venue} onChange={(e) => setEditing({ ...editing, venue: e.target.value })} />}</Field>
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
            <h2 className="font-display text-2xl font-black uppercase tracking-tight text-ink">Bracket preview</h2>
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
