import { useEffect, useState } from 'react';
import { Archive, Check, Layers, Loader2, Plus, RotateCcw, Save, Star, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// Dictator flow for divisions, seasons and season sections. Writes go straight to the Data API with the signed-in
// user's session, so row level security decides (only a dictator may write); this screen only reports the answer.

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
export const SEASON_STATUSES = ['planned', 'registration', 'active', 'completed'];
export const SEASON_FORMATS = [
  { value: 'league', label: 'League' },
  { value: 'knockout', label: 'Knockout' },
  { value: 'league_knockout', label: 'League + knockout' },
];

const blankDivision = () => ({ slug: '', name: '', short_name: '', visibility: 'public', primary_color: '' });
const blankSeason = () => ({ slug: '', name: '', starts_on: '', ends_on: '', status: 'planned', format: 'league' });

export function validateDivision(d) {
  if (!d.name.trim()) return 'Enter a division name.';
  if (!SLUG.test(d.slug)) return 'The slug may use lowercase letters, numbers and single hyphens (for example "inter").';
  if (d.primary_color && !HEX.test(d.primary_color)) return 'The colour must look like #1a2b3c.';
  return '';
}

export function validateSeason(s) {
  if (!s.name.trim()) return 'Enter a season name.';
  if (!SLUG.test(s.slug)) return 'The slug may use lowercase letters, numbers and single hyphens (for example "2026-27").';
  if (s.starts_on && s.ends_on && s.ends_on < s.starts_on) return 'The end date must not be before the start date.';
  return '';
}

export function parseSettings(text) {
  if (!text.trim()) return { value: {} };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Settings must be a JSON object, for example {"placement": "top"}.' };
    return { value };
  } catch {
    return { error: 'Settings are not valid JSON.' };
  }
}

export function describeError(error) {
  if (!error) return '';
  if (error.code === '42501') return 'Only a dictator can change divisions, seasons and sections.';
  if (error.code === '23505') return 'That slug is already used here. Choose another one.';
  if (error.code === '23503') return 'This record already has data, so it cannot be deleted. Archive it instead.';
  return error.message || 'Something went wrong. Try again.';
}

const inputClass = 'w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[#d9ff4a]/60';
const labelClass = 'text-[10px] font-black uppercase tracking-widest text-zinc-500';
const ghostButton = 'flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-zinc-300 hover:bg-white/5 disabled:opacity-40';
const primaryButton = 'flex items-center gap-2 rounded-lg bg-[#d9ff4a] px-3 py-2 text-xs font-black uppercase text-black disabled:opacity-40';
const badge = (text, tone = 'zinc') => <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${tone === 'lime' ? 'border-[#d9ff4a]/40 text-[#d9ff4a]' : tone === 'red' ? 'border-red-500/30 text-red-300' : 'border-white/15 text-zinc-400'}`}>{text}</span>;

export default function ManageDivisions() {
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newDivision, setNewDivision] = useState(blankDivision);
  const [selectedDivision, setSelectedDivision] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [newSeason, setNewSeason] = useState(blankSeason);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [sections, setSections] = useState([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);

  const report = (err, success) => {
    if (err) { setMessage(''); setError(describeError(err)); return false; }
    setError(''); setMessage(success); return true;
  };

  const loadDivisions = async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('divisions')
      .select('id, slug, name, short_name, visibility, archived_at, primary_color, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (loadError) setError(describeError(loadError));
    setDivisions(data || []);
    setLoading(false);
  };

  const loadSeasons = async (divisionId) => {
    setSeasonsLoading(true);
    const { data, error: loadError } = await supabase
      .from('seasons')
      .select('id, slug, name, starts_on, ends_on, status, format, is_current, archived_at, sort_order')
      .eq('division_id', divisionId)
      .order('sort_order', { ascending: true })
      .order('slug', { ascending: false });
    if (loadError) setError(describeError(loadError));
    setSeasons(data || []);
    setSeasonsLoading(false);
  };

  const loadSections = async (seasonId) => {
    setSectionsLoading(true);
    const [types, rows] = await Promise.all([
      supabase.from('section_types').select('key, label, description, default_enabled, default_sort_order').order('default_sort_order', { ascending: true }),
      supabase.from('season_sections').select('section_key, enabled, nav_visible, sort_order, settings').eq('season_id', seasonId),
    ]);
    if (types.error || rows.error) setError(describeError(types.error || rows.error));
    const byKey = new Map((rows.data || []).map((r) => [r.section_key, r]));
    setSections((types.data || []).map((t) => {
      const row = byKey.get(t.key);
      return {
        key: t.key,
        label: t.label,
        description: t.description,
        saved: Boolean(row),
        enabled: row ? row.enabled : t.default_enabled,
        nav_visible: row ? row.nav_visible : t.default_enabled,
        sort_order: row ? row.sort_order : t.default_sort_order,
        settingsText: row && Object.keys(row.settings || {}).length ? JSON.stringify(row.settings) : '',
      };
    }));
    setSectionsLoading(false);
  };

  useEffect(() => { loadDivisions(); }, []);

  const chooseDivision = (division) => {
    setSelectedDivision(division);
    setSelectedSeason(null);
    setSeasons([]);
    setSections([]);
    setNewSeason(blankSeason());
    loadSeasons(division.id);
  };

  const chooseSeason = (season) => {
    setSelectedSeason(season);
    setSections([]);
    loadSections(season.id);
  };

  // Divisions -------------------------------------------------------------------------------------------------

  const createDivision = async (event) => {
    event.preventDefault();
    const invalid = validateDivision(newDivision);
    if (invalid) { setMessage(''); setError(invalid); return; }
    setBusy('create-division');
    const { error: err } = await supabase.from('divisions').insert({
      slug: newDivision.slug,
      name: newDivision.name.trim(),
      short_name: newDivision.short_name.trim() || null,
      visibility: newDivision.visibility,
      primary_color: newDivision.primary_color || null,
      sort_order: divisions.length + 1,
    });
    setBusy('');
    if (report(err, `Division "${newDivision.name.trim()}" created.`)) {
      setNewDivision(blankDivision());
      loadDivisions();
    }
  };

  const changeDivision = (id, field, value) => setDivisions((list) => list.map((d) => (d.id === id ? { ...d, [field]: value } : d)));

  const saveDivision = async (division) => {
    const invalid = validateDivision({ ...division, short_name: division.short_name || '', primary_color: division.primary_color || '' });
    if (invalid) { setMessage(''); setError(invalid); return; }
    setBusy(`division-${division.id}`);
    const { data, error: err } = await supabase.from('divisions')
      .update({ name: division.name.trim(), visibility: division.visibility })
      .eq('id', division.id).select('id');
    setBusy('');
    if (!err && !data?.length) { report({ code: '42501' }); return; }
    if (report(err, `Division "${division.name.trim()}" saved.`)) loadDivisions();
  };

  const setDivisionArchived = async (division, archived) => {
    setBusy(`division-${division.id}`);
    const { data, error: err } = await supabase.from('divisions')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', division.id).select('id');
    setBusy('');
    if (!err && !data?.length) { report({ code: '42501' }); return; }
    if (report(err, archived ? `Division "${division.name}" archived. It is hidden from visitors and can be restored.` : `Division "${division.name}" restored.`)) loadDivisions();
  };

  const deleteDivision = async (division) => {
    if (!window.confirm(`Delete the division "${division.name}"? This only works while it has no seasons.`)) return;
    setBusy(`division-${division.id}`);
    const { data, error: err } = await supabase.from('divisions').delete().eq('id', division.id).select('id');
    setBusy('');
    if (!err && !data?.length) { report({ code: '42501' }); return; }
    if (report(err, `Division "${division.name}" deleted.`)) {
      if (selectedDivision?.id === division.id) { setSelectedDivision(null); setSeasons([]); setSelectedSeason(null); }
      loadDivisions();
    }
  };

  // Seasons ---------------------------------------------------------------------------------------------------

  const createSeason = async (event) => {
    event.preventDefault();
    const invalid = validateSeason(newSeason);
    if (invalid) { setMessage(''); setError(invalid); return; }
    setBusy('create-season');
    const { data, error: err } = await supabase.from('seasons').insert({
      division_id: selectedDivision.id,
      slug: newSeason.slug,
      name: newSeason.name.trim(),
      starts_on: newSeason.starts_on || null,
      ends_on: newSeason.ends_on || null,
      status: newSeason.status,
      format: newSeason.format,
      sort_order: seasons.length + 1,
    }).select('id').single();
    if (err) { setBusy(''); report(err); return; }
    // Every new season starts with the default sections, which the dictator then adjusts.
    const { data: types, error: typesError } = await supabase.from('section_types').select('key, default_enabled, default_sort_order');
    const { error: sectionsError } = typesError ? { error: typesError } : await supabase.from('season_sections').insert(
      (types || []).map((t) => ({ season_id: data.id, section_key: t.key, enabled: t.default_enabled, nav_visible: t.default_enabled, sort_order: t.default_sort_order, settings: {} })),
      { defaultToNull: false },
    );
    setBusy('');
    if (sectionsError) {
      setMessage('');
      setError(`Season created, but its default sections were not saved: ${describeError(sectionsError)} Open the season to configure them.`);
    } else {
      report(null, `Season "${newSeason.name.trim()}" created with the default sections.`);
    }
    setNewSeason(blankSeason());
    loadSeasons(selectedDivision.id);
  };

  const changeSeason = (id, field, value) => setSeasons((list) => list.map((s) => (s.id === id ? { ...s, [field]: value } : s)));

  const saveSeason = async (season) => {
    const invalid = validateSeason({ ...season, starts_on: season.starts_on || '', ends_on: season.ends_on || '' });
    if (invalid) { setMessage(''); setError(invalid); return; }
    setBusy(`season-${season.id}`);
    const { data, error: err } = await supabase.from('seasons')
      .update({ name: season.name.trim(), status: season.status, format: season.format, starts_on: season.starts_on || null, ends_on: season.ends_on || null })
      .eq('id', season.id).select('id');
    if (!err && data?.length) await supabase.rpc('refresh_captain_grants'); // a completed season is read-only: lapse captain grants with no writable assignment left
    setBusy('');
    if (!err && !data?.length) { report({ code: '42501' }); return; }
    if (report(err, `Season "${season.name.trim()}" saved.`)) loadSeasons(selectedDivision.id);
  };

  const makeCurrent = async (season) => {
    setBusy(`season-${season.id}`);
    const { error: err } = await supabase.rpc('set_current_season', { p_season: season.id });
    setBusy('');
    if (report(err, `"${season.name}" is now the current season of ${selectedDivision.name}.`)) loadSeasons(selectedDivision.id);
  };

  const setSeasonArchived = async (season, archived) => {
    setBusy(`season-${season.id}`);
    const { data, error: err } = await supabase.from('seasons')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', season.id).select('id');
    if (!err && data?.length && archived) await supabase.rpc('refresh_captain_grants'); // an archived season is read-only: lapse captain grants with no writable assignment left
    setBusy('');
    if (!err && !data?.length) { report({ code: '42501' }); return; }
    if (report(err, archived ? `Season "${season.name}" archived.` : `Season "${season.name}" restored.`)) loadSeasons(selectedDivision.id);
  };

  // Sections --------------------------------------------------------------------------------------------------

  const changeSection = (key, field, value) => setSections((list) => list.map((s) => (s.key === key ? { ...s, [field]: value } : s)));

  const saveSection = async (section) => {
    const settings = parseSettings(section.settingsText);
    if (settings.error) { setMessage(''); setError(`${section.label}: ${settings.error}`); return; }
    setBusy(`section-${section.key}`);
    const { error: err } = await supabase.from('season_sections').upsert({
      season_id: selectedSeason.id,
      section_key: section.key,
      enabled: section.enabled,
      nav_visible: section.nav_visible,
      sort_order: Number(section.sort_order) || 0,
      settings: settings.value,
    }, { onConflict: 'season_id,section_key' });
    setBusy('');
    if (report(err, `${section.label} saved for ${selectedSeason.name}.`)) loadSections(selectedSeason.id);
  };

  // Render ----------------------------------------------------------------------------------------------------

  return <div className="space-y-6 p-6">
    <div>
      <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><Layers size={20} /> Divisions &amp; seasons</h2>
      <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Create divisions, run their seasons and choose which sections each season shows</p>
    </div>

    {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}

    <form onSubmit={createDivision} aria-label="New division" className="grid gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-5 lg:grid-cols-[1.3fr_1fr_1fr_140px_120px_auto] lg:items-end">
      <label className={labelClass}>Division name<input value={newDivision.name} onChange={(e) => setNewDivision({ ...newDivision, name: e.target.value })} placeholder="Inter" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
      <label className={labelClass}>Slug<input value={newDivision.slug} onChange={(e) => setNewDivision({ ...newDivision, slug: e.target.value.trim().toLowerCase() })} placeholder="inter" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
      <label className={labelClass}>Short name<input value={newDivision.short_name} onChange={(e) => setNewDivision({ ...newDivision, short_name: e.target.value })} placeholder="Optional" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
      <label className={labelClass}>Visibility<select value={newDivision.visibility} onChange={(e) => setNewDivision({ ...newDivision, visibility: e.target.value })} className={`${inputClass} mt-1 normal-case tracking-normal`}><option value="public">Public</option><option value="hidden">Hidden</option></select></label>
      <label className={labelClass}>Colour<input value={newDivision.primary_color} onChange={(e) => setNewDivision({ ...newDivision, primary_color: e.target.value })} placeholder="#d9ff4a" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
      <button type="submit" disabled={busy === 'create-division'} className={primaryButton}>{busy === 'create-division' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add division</button>
    </form>

    {loading && !divisions.length ? <p className="text-zinc-500">Loading divisions...</p> : !divisions.length
      ? <p className="text-zinc-500">No divisions yet. Add the first one above.</p>
      : <ul aria-label="Divisions" className="space-y-3">{divisions.map((d) => <li key={d.id} className={`grid gap-3 rounded-2xl border p-4 lg:grid-cols-[1.5fr_140px_auto] lg:items-center ${selectedDivision?.id === d.id ? 'border-[#d9ff4a]/40 bg-[#d9ff4a]/[.04]' : 'border-white/10 bg-white/[.03]'}`}>
        <div className="space-y-1">
          <input aria-label={`Name of ${d.slug}`} value={d.name} onChange={(e) => changeDivision(d.id, 'name', e.target.value)} className={`${inputClass} font-bold`} />
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">/{d.slug} {d.visibility === 'hidden' && badge('Hidden')} {d.archived_at && badge('Archived', 'red')}</div>
        </div>
        <select aria-label={`Visibility of ${d.slug}`} value={d.visibility} onChange={(e) => changeDivision(d.id, 'visibility', e.target.value)} className={inputClass}><option value="public">Public</option><option value="hidden">Hidden</option></select>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => saveDivision(d)} disabled={busy === `division-${d.id}`} className={ghostButton}><Save size={13} /> Save</button>
          <button type="button" onClick={() => chooseDivision(d)} className={ghostButton}><Layers size={13} /> Seasons</button>
          {d.archived_at
            ? <button type="button" onClick={() => setDivisionArchived(d, false)} disabled={busy === `division-${d.id}`} className={ghostButton}><RotateCcw size={13} /> Restore</button>
            : <button type="button" onClick={() => setDivisionArchived(d, true)} disabled={busy === `division-${d.id}`} className={ghostButton}><Archive size={13} /> Archive</button>}
          <button type="button" onClick={() => deleteDivision(d)} disabled={busy === `division-${d.id}`} aria-label={`Delete ${d.name}`} className="rounded-lg border border-red-500/30 px-3 py-2 text-red-400 disabled:opacity-40"><Trash2 size={13} /></button>
        </div>
      </li>)}</ul>}

    {selectedDivision && <section aria-label={`Seasons of ${selectedDivision.name}`} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.02] p-5">
      <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300">Seasons of {selectedDivision.name}</h3>
      <form onSubmit={createSeason} aria-label="New season" className="grid gap-3 lg:grid-cols-[1fr_1fr_150px_150px_140px_160px_auto] lg:items-end">
        <label className={labelClass}>Season name<input value={newSeason.name} onChange={(e) => setNewSeason({ ...newSeason, name: e.target.value })} placeholder="2026–27" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
        <label className={labelClass}>Season slug<input value={newSeason.slug} onChange={(e) => setNewSeason({ ...newSeason, slug: e.target.value.trim().toLowerCase() })} placeholder="2026-27" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
        <label className={labelClass}>Starts<input type="date" value={newSeason.starts_on} onChange={(e) => setNewSeason({ ...newSeason, starts_on: e.target.value })} className={`${inputClass} mt-1`} /></label>
        <label className={labelClass}>Ends<input type="date" value={newSeason.ends_on} onChange={(e) => setNewSeason({ ...newSeason, ends_on: e.target.value })} className={`${inputClass} mt-1`} /></label>
        <label className={labelClass}>Status<select value={newSeason.status} onChange={(e) => setNewSeason({ ...newSeason, status: e.target.value })} className={`${inputClass} mt-1 normal-case tracking-normal`}>{SEASON_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className={labelClass}>Format<select value={newSeason.format} onChange={(e) => setNewSeason({ ...newSeason, format: e.target.value })} className={`${inputClass} mt-1 normal-case tracking-normal`}>{SEASON_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
        <button type="submit" disabled={busy === 'create-season'} className={primaryButton}>{busy === 'create-season' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add season</button>
      </form>

      {seasonsLoading && !seasons.length ? <p className="text-zinc-500">Loading seasons...</p> : !seasons.length
        ? <p className="text-zinc-500">No seasons yet. Add the first season of {selectedDivision.name} above.</p>
        : <ul aria-label="Seasons" className="space-y-2">{seasons.map((s) => <li key={s.id} className={`grid gap-2 rounded-xl border p-3 lg:grid-cols-[1fr_140px_140px_140px_150px_auto] lg:items-center ${selectedSeason?.id === s.id ? 'border-[#d9ff4a]/40' : 'border-white/5 bg-black/30'}`}>
          <div className="space-y-1">
            <input aria-label={`Name of season ${s.slug}`} value={s.name} onChange={(e) => changeSeason(s.id, 'name', e.target.value)} className={`${inputClass} font-bold`} />
            <div className="flex flex-wrap gap-2">{s.is_current && badge('Current', 'lime')} {s.archived_at && badge('Archived', 'red')}</div>
          </div>
          <input aria-label={`Start of season ${s.slug}`} type="date" value={s.starts_on || ''} onChange={(e) => changeSeason(s.id, 'starts_on', e.target.value)} className={inputClass} />
          <input aria-label={`End of season ${s.slug}`} type="date" value={s.ends_on || ''} onChange={(e) => changeSeason(s.id, 'ends_on', e.target.value)} className={inputClass} />
          <select aria-label={`Status of season ${s.slug}`} value={s.status} onChange={(e) => changeSeason(s.id, 'status', e.target.value)} className={inputClass}>{SEASON_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select aria-label={`Format of season ${s.slug}`} value={s.format} onChange={(e) => changeSeason(s.id, 'format', e.target.value)} className={inputClass}>{SEASON_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => saveSeason(s)} disabled={busy === `season-${s.id}`} className={ghostButton}><Save size={13} /> Save</button>
            <button type="button" onClick={() => chooseSeason(s)} className={ghostButton}><Layers size={13} /> Sections</button>
            {!s.is_current && !s.archived_at && <button type="button" onClick={() => makeCurrent(s)} disabled={busy === `season-${s.id}`} className={ghostButton}><Star size={13} /> Make current</button>}
            {s.archived_at
              ? <button type="button" onClick={() => setSeasonArchived(s, false)} disabled={busy === `season-${s.id}`} className={ghostButton}><RotateCcw size={13} /> Restore</button>
              : <button type="button" onClick={() => setSeasonArchived(s, true)} disabled={busy === `season-${s.id}`} className={ghostButton}><Archive size={13} /> Archive</button>}
          </div>
        </li>)}</ul>}
    </section>}

    {selectedSeason && <section aria-label={`Sections of ${selectedSeason.name}`} className="space-y-3 rounded-2xl border border-white/10 bg-white/[.02] p-5">
      <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300">Sections of {selectedDivision?.name} {selectedSeason.name}</h3>
      {sectionsLoading && !sections.length ? <p className="text-zinc-500">Loading sections...</p> : !sections.length
        ? <p className="text-zinc-500">No section types are defined.</p>
        : <ul aria-label="Sections" className="space-y-2">{sections.map((sec) => <li key={sec.key} className="grid gap-2 rounded-xl border border-white/5 bg-black/30 p-3 lg:grid-cols-[1.2fr_auto_auto_90px_1.4fr_auto] lg:items-center">
          <div><p className="text-sm font-bold">{sec.label}</p><p className="text-[10px] text-zinc-500">{sec.description}{!sec.saved && ' · default, not saved yet'}</p></div>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={sec.enabled} onChange={(e) => changeSection(sec.key, 'enabled', e.target.checked)} aria-label={`${sec.label} enabled`} /> Enabled</label>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={sec.nav_visible} onChange={(e) => changeSection(sec.key, 'nav_visible', e.target.checked)} aria-label={`${sec.label} in navigation`} /> In navigation</label>
          <input type="number" aria-label={`${sec.label} order`} value={sec.sort_order} onChange={(e) => changeSection(sec.key, 'sort_order', e.target.value)} className={inputClass} />
          <input aria-label={`${sec.label} settings`} value={sec.settingsText} onChange={(e) => changeSection(sec.key, 'settingsText', e.target.value)} placeholder='Settings JSON, e.g. {"placement": "top"}' className={`${inputClass} font-mono text-xs`} />
          <button type="button" onClick={() => saveSection(sec)} disabled={busy === `section-${sec.key}`} className={ghostButton}>{busy === `section-${sec.key}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
        </li>)}</ul>}
    </section>}
  </div>;
}
