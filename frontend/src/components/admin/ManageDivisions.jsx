import { useEffect, useRef, useState } from 'react';
import { Archive, Check, Layers, Loader2, Plus, RotateCcw, Save, ScrollText, Star, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchApi } from '../../hooks/useApi';
import ManageRules from './ManageRules';
import { useConfirm } from '../ui';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
export const SEASON_STATUSES = ['planned', 'registration', 'active', 'completed'];
export const SEASON_FORMATS = [
  { value: 'league', label: 'League' },
  { value: 'knockout', label: 'Knockout' },
  { value: 'league_knockout', label: 'League + knockout' },
];

const blankDivision = () => ({ slug: '', name: '', short_name: '', primary_color: '' });
const blankSeason = () => ({ slug: '', name: '', starts_on: '', ends_on: '', format: 'league' });
// The slug follows the name until someone types a slug of their own.
const slugify = (text) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-$/g, '');
const followSlug = (current, name) => (!current.slug || current.slug === slugify(current.name) ? slugify(name) : current.slug);

export function validateDivision(d) {
  if (!d.name.trim()) return 'Enter a division name.';
  if (!SLUG.test(d.slug)) return 'The slug may use lowercase letters, numbers and single hyphens (for example "inter").';
  if ([d.primary_color, d.secondary_color].some((value) => value && !HEX.test(value))) return 'The colour must look like #1a2b3c.';
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
  if (error.code === '42501' || error.status === 403) return 'Only a dictator can change divisions, seasons and sections.';
  if (error.code === '23505') return 'That slug is already used here. Choose another one.';
  if (error.code === '23503') return 'This record already has data, so it cannot be deleted. Archive it instead.';
  return error.message || 'The request did not complete. Try again.';
}

const inputClass = 'w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[#d9ff4a]/60';
const labelClass = 'text-[10px] font-black uppercase tracking-widest text-zinc-500';
const ghostButton = 'flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-zinc-300 hover:bg-white/5 disabled:opacity-40';
const primaryButton = 'flex items-center gap-2 rounded-lg bg-[#d9ff4a] px-3 py-2 text-xs font-black uppercase text-black disabled:opacity-40';
const badge = (text, tone = 'zinc') => <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${tone === 'lime' ? 'border-[#d9ff4a]/40 text-[#d9ff4a]' : tone === 'red' ? 'border-red-500/30 text-red-300' : 'border-white/15 text-zinc-400'}`}>{text}</span>;

export default function ManageDivisions() {
  const confirm = useConfirm();
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newDivision, setNewDivision] = useState(blankDivision);
  const [selectedDivisionId, setSelectedDivisionId] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [newSeason, setNewSeason] = useState(blankSeason);
  const [selectedSeasonId, setSelectedSeasonId] = useState(null);
  const [sections, setSections] = useState([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [rulesSeasonId, setRulesSeasonId] = useState(null);
  const seasonLoad = useRef(0);
  const sectionLoad = useRef(0);
  const selectedDivision = divisions.find(({ id }) => id === selectedDivisionId);
  const selectedSeason = seasons.find(({ id }) => id === selectedSeasonId);
  const rulesSeason = seasons.find(({ id }) => id === rulesSeasonId);

  const report = (err, success) => {
    if (err) { setMessage(''); setError(describeError(err)); return false; }
    setError(''); setMessage(success); return true;
  };

  const loadDivisions = async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('divisions')
      .select('id, slug, name, short_name, visibility, archived_at, logo_url, landing_video_key, is_featured, primary_color, secondary_color, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (loadError) setError(describeError(loadError));
    setDivisions(data || []);
    setLoading(false);
  };

  const loadSeasons = async (divisionId) => {
    const request = ++seasonLoad.current;
    setSeasonsLoading(true);
    const { data, error: loadError } = await supabase
      .from('seasons')
      .select('id, slug, name, starts_on, ends_on, status, format, is_current, visibility, archived_at, sort_order')
      .eq('division_id', divisionId)
      .order('sort_order', { ascending: true })
      .order('slug', { ascending: false });
    if (request !== seasonLoad.current) return;
    if (loadError) setError(describeError(loadError));
    setSeasons(data || []);
    setSeasonsLoading(false);
  };

  const loadSections = async (seasonId) => {
    const request = ++sectionLoad.current;
    setSectionsLoading(true);
    const [types, rows] = await Promise.all([
      supabase.from('section_types').select('key, label, description, default_enabled, default_sort_order').order('default_sort_order', { ascending: true }),
      supabase.from('season_sections').select('section_key, label, enabled, nav_visible, sort_order, settings').eq('season_id', seasonId),
    ]);
    if (request !== sectionLoad.current) return;
    if (types.error || rows.error) {
      setError(describeError(types.error || rows.error));
      setSections([]);
      setSectionsLoading(false);
      return;
    }
    const byKey = new Map((rows.data || []).map((r) => [r.section_key, r]));
    setSections((types.data || []).map((t) => {
      const row = byKey.get(t.key);
      return {
        key: t.key,
        label: t.label,
        customLabel: row?.label || '',
        description: t.description,
        saved: Boolean(row),
        enabled: row ? row.enabled : t.default_enabled,
        nav_visible: row ? row.nav_visible : t.default_enabled,
        sort_order: row ? row.sort_order : t.default_sort_order,
        settingsText: row && Object.keys(row.settings || {}).length ? JSON.stringify(row.settings) : '',
      };
    }).sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key)));
    setSectionsLoading(false);
  };

  useEffect(() => { loadDivisions(); }, []);

  const chooseDivision = (division) => {
    setSelectedDivisionId(division.id);
    setSelectedSeasonId(null);
    sectionLoad.current += 1;
    setSeasons([]);
    setSections([]);
    setNewSeason(blankSeason());
    loadSeasons(division.id);
  };

  const chooseSeason = (season) => {
    setSelectedSeasonId(season.id);
    setSections([]);
    loadSections(season.id);
  };

  const write = async (action, path, method, body, success, reload) => {
    setBusy(action);
    try {
      await fetchApi(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      report(null, success);
      await reload?.();
    } catch (failure) {
      report(failure);
    } finally {
      setBusy('');
    }
  };

  const createDivision = (event) => {
    event.preventDefault();
    const invalid = validateDivision(newDivision);
    if (invalid) return report(new Error(invalid));
    const { slug, name, short_name, primary_color } = newDivision;
    return write('create-division', '/admin/divisions', 'POST', {
      slug, name: name.trim(), short_name: short_name.trim() || null, primary_color: primary_color || null,
    }, `Division "${name.trim()}" created.`, () => {
      setNewDivision(blankDivision());
      return loadDivisions();
    });
  };

  const changeDivision = (id, field, value) => setDivisions((list) => list.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  const patchDivision = (division, body, message) => write(
    `division-${division.id}`, `/admin/divisions/${division.id}`, 'PATCH', body, message, loadDivisions,
  );

  const saveDivision = (division) => {
    const invalid = validateDivision(division);
    if (invalid) return report(new Error(invalid));
    const { name, short_name, logo_url, landing_video_key, primary_color, secondary_color } = division;
    return patchDivision(division, {
      name: name.trim(), short_name: short_name?.trim() || null, logo_url: logo_url?.trim() || null,
      landing_video_key: landing_video_key?.trim() || null,
      primary_color: primary_color || null, secondary_color: secondary_color || null,
    }, `Division "${name.trim()}" saved.`);
  };

  const featureDivision = async (division) => {
    const ok = await confirm({ title: `Make ${division.name} the current division?`, description: 'This changes the division featured on the landing page.', confirmLabel: 'Make current' });
    if (ok) return write(`division-${division.id}`, `/admin/divisions/${division.id}/current`, 'POST', undefined,
      `${division.name} is now the current division.`, loadDivisions);
  };

  const deleteDivision = async (division) => {
    if (!(await confirm({ title: `Delete ${division.name}?`, description: 'This only works while the division has no seasons.', confirmLabel: 'Delete division', tone: 'danger' }))) return;
    return write(`division-${division.id}`, `/admin/divisions/${division.id}`, 'DELETE', undefined,
      `Division "${division.name}" deleted.`, () => {
        if (selectedDivision?.id === division.id) {
          setSelectedDivisionId(null);
          setSeasons([]);
          setSelectedSeasonId(null);
        }
        return loadDivisions();
      });
  };

  const reloadSeasons = () => loadSeasons(selectedDivision.id);

  const createSeason = (event) => {
    event.preventDefault();
    const invalid = validateSeason(newSeason);
    if (invalid) return report(new Error(invalid));
    const { slug, name, starts_on, ends_on, format } = newSeason;
    return write('create-season', '/admin/seasons', 'POST', {
      division_id: selectedDivision.id, slug, name: name.trim(), starts_on: starts_on || null, ends_on: ends_on || null, format,
    }, `Season "${name.trim()}" created with the default sections.`, () => {
      setNewSeason(blankSeason());
      return reloadSeasons();
    });
  };

  const changeSeason = (id, field, value) => setSeasons((list) => list.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  const patchSeason = (season, body, message) => write(
    `season-${season.id}`, `/admin/seasons/${season.id}`, 'PATCH', body, message, reloadSeasons,
  );

  const saveSeason = (season) => {
    const invalid = validateSeason(season);
    if (invalid) return report(new Error(invalid));
    return patchSeason(season, {
      name: season.name.trim(), status: season.status, format: season.format,
      starts_on: season.starts_on || null, ends_on: season.ends_on || null,
    }, `Season "${season.name.trim()}" saved.`);
  };

  const makeCurrent = async (season) => {
    const ok = await confirm({ title: `Make ${season.name} the current season?`, description: `The public site shows ${season.name} for ${selectedDivision.name} from now on.`, confirmLabel: 'Make current' });
    if (ok) return write(`season-${season.id}`, `/admin/seasons/${season.id}/current`, 'POST', undefined, `"${season.name}" is now the current season of ${selectedDivision.name}.`, reloadSeasons);
  };

  const move = (items, index, offset) => {
    const ordered = [...items];
    [ordered[index], ordered[index + offset]] = [ordered[index + offset], ordered[index]];
    return ordered;
  };

  const reorder = (type, items, index, offset) => {
    const ids = move(items, index, offset).map(({ id }) => id);
    const body = type === 'seasons' ? { ids, division_id: selectedDivision.id } : { ids };
    return write('reorder', `/admin/${type}/order`, 'PUT', body, 'Order saved.',
      type === 'seasons' ? reloadSeasons : loadDivisions);
  };

  const orderButtons = (name, index, length, onMove) => (
    <>
      <button type="button" aria-label={`Move ${name} up`} className={ghostButton} disabled={!!busy || index === 0} onClick={() => onMove(-1)}>↑</button>
      <button type="button" aria-label={`Move ${name} down`} className={ghostButton} disabled={!!busy || index === length - 1} onClick={() => onMove(1)}>↓</button>
    </>
  );

  const lifecycleButtons = (record, patch) => {
    if (record.archived_at) {
      return <button type="button" disabled={!!busy} onClick={() => patch(record, { archived: false }, `"${record.name}" restored.`)} className={ghostButton}><RotateCcw size={13} /> Restore</button>;
    }
    const next = record.visibility === 'public' ? 'hidden' : 'public';
    return <>
      <button type="button" disabled={!!busy} onClick={() => patch(record, { visibility: next }, `"${record.name}" is now ${next}.`)} className={ghostButton}>{next === 'public' ? 'Publish' : 'Hide'}</button>
      <button type="button" disabled={!!busy} onClick={() => patch(record, { archived: true }, `"${record.name}" archived.`)} className={ghostButton}><Archive size={13} /> Archive</button>
    </>;
  };

  const stateBadge = (row) => row.archived_at ? badge('Archived', 'red') : badge(row.visibility === 'public' ? 'Public' : 'Hidden');
  const changeSection = (key, field, value) => setSections((list) => list.map((s) => (s.key === key ? { ...s, [field]: value } : s)));

  const saveSections = () => {
    const rows = [];
    for (const section of sections) {
      const settings = parseSettings(section.settingsText);
      if (settings.error) return report(new Error(`${section.label}: ${settings.error}`));
      rows.push({ section_key: section.key, label: section.customLabel.trim() || null,
        enabled: section.enabled, nav_visible: section.nav_visible, settings: settings.value });
    }
    return write('save-sections', `/admin/seasons/${selectedSeason.id}/sections`, 'PUT', { sections: rows },
      `Sections saved for ${selectedSeason.name}.`, () => loadSections(selectedSeason.id));
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
      <label className={labelClass}>Division name<input value={newDivision.name} onChange={(e) => setNewDivision((d) => ({ ...d, name: e.target.value, slug: followSlug(d, e.target.value) }))} placeholder="Inter" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
      <label className={labelClass}>Slug<input value={newDivision.slug} onChange={(e) => setNewDivision({ ...newDivision, slug: e.target.value.trim().toLowerCase() })} placeholder="inter" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
      <label className={labelClass}>Short name<input value={newDivision.short_name} onChange={(e) => setNewDivision({ ...newDivision, short_name: e.target.value })} placeholder="Optional" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
      <label className={labelClass}>Colour<input value={newDivision.primary_color} onChange={(e) => setNewDivision({ ...newDivision, primary_color: e.target.value })} placeholder="#d9ff4a" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
      <button type="submit" disabled={!!busy} className={primaryButton}>{busy === 'create-division' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add division</button>
    </form>

    {loading && !divisions.length ? <p className="text-zinc-500">Loading divisions...</p> : !divisions.length
      ? <p className="text-zinc-500">No divisions yet. Add the first one above.</p>
      : <ul aria-label="Divisions" className="space-y-3">{divisions.map((d, index) => <li key={d.id} className={`grid gap-3 rounded-2xl border p-4 lg:grid-cols-[1.5fr_140px_auto] lg:items-center ${selectedDivision?.id === d.id ? 'border-[#d9ff4a]/40 bg-[#d9ff4a]/[.04]' : 'border-white/10 bg-white/[.03]'}`}>
        <div className="space-y-1">
          <input aria-label={`Name of ${d.slug}`} value={d.name} onChange={(e) => changeDivision(d.id, 'name', e.target.value)} className={`${inputClass} font-bold`} />
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">/{d.slug} {stateBadge(d)} {d.is_featured && badge('Current division', 'lime')}</div>
          <label className={labelClass}>Logo URL<input aria-label={`Logo URL of ${d.slug}`} value={d.logo_url || ''} onChange={(e) => changeDivision(d.id, 'logo_url', e.target.value)} className={inputClass} /></label>
          <label className={labelClass}>Landing video key<input aria-label={`Landing video key of ${d.slug}`} value={d.landing_video_key || ''} onChange={(e) => changeDivision(d.id, 'landing_video_key', e.target.value)} className={inputClass} /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => saveDivision(d)} disabled={!!busy} className={ghostButton}><Save size={13} /> Save</button>
          <button type="button" onClick={() => chooseDivision(d)} disabled={!!busy} className={ghostButton}><Layers size={13} /> Seasons</button>
          {!d.is_featured && d.visibility === 'public' && !d.archived_at && <button type="button" onClick={() => featureDivision(d)} disabled={!!busy} className={ghostButton}><Star size={13} /> Make current division</button>}
          {lifecycleButtons(d, patchDivision)}
          {orderButtons(d.name, index, divisions.length, (offset) => reorder('divisions', divisions, index, offset))}
          <button type="button" onClick={() => deleteDivision(d)} disabled={!!busy} aria-label={`Delete ${d.name}`} className="rounded-lg border border-red-500/30 px-3 py-2 text-red-400 disabled:opacity-40"><Trash2 size={13} /></button>
        </div>
      </li>)}</ul>}

    {selectedDivision && <section aria-label={`Seasons of ${selectedDivision.name}`} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.02] p-5">
      <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300">Seasons of {selectedDivision.name}</h3>
      <form onSubmit={createSeason} aria-label="New season" className="grid gap-3 lg:grid-cols-[1fr_1fr_150px_150px_140px_160px_auto] lg:items-end">
        <label className={labelClass}>Season name<input value={newSeason.name} onChange={(e) => setNewSeason((x) => ({ ...x, name: e.target.value, slug: followSlug(x, e.target.value) }))} placeholder="2026–27" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
        <label className={labelClass}>Season slug<input value={newSeason.slug} onChange={(e) => setNewSeason({ ...newSeason, slug: e.target.value.trim().toLowerCase() })} placeholder="2026-27" className={`${inputClass} mt-1 normal-case tracking-normal`} /></label>
        <label className={labelClass}>Starts<input type="date" value={newSeason.starts_on} onChange={(e) => setNewSeason({ ...newSeason, starts_on: e.target.value })} className={`${inputClass} mt-1`} /></label>
        <label className={labelClass}>Ends<input type="date" value={newSeason.ends_on} onChange={(e) => setNewSeason({ ...newSeason, ends_on: e.target.value })} className={`${inputClass} mt-1`} /></label>
        <label className={labelClass}>Format<select value={newSeason.format} onChange={(e) => setNewSeason({ ...newSeason, format: e.target.value })} className={`${inputClass} mt-1 normal-case tracking-normal`}>{SEASON_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
        <button type="submit" disabled={!!busy} className={primaryButton}>{busy === 'create-season' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add season</button>
      </form>

      {seasonsLoading && !seasons.length ? <p className="text-zinc-500">Loading seasons...</p> : !seasons.length
        ? <p className="text-zinc-500">No seasons yet. Add the first season of {selectedDivision.name} above.</p>
        : <ul aria-label="Seasons" className="space-y-2">{seasons.map((s, index) => <li key={s.id} className={`grid gap-2 rounded-xl border p-3 lg:grid-cols-[1fr_140px_140px_140px_150px_auto] lg:items-center ${selectedSeason?.id === s.id ? 'border-[#d9ff4a]/40' : 'border-white/5 bg-black/30'}`}>
          <div className="space-y-1">
            <input aria-label={`Name of season ${s.slug}`} value={s.name} onChange={(e) => changeSeason(s.id, 'name', e.target.value)} className={`${inputClass} font-bold`} />
            <div className="flex flex-wrap gap-2">{s.is_current && badge('Current', 'lime')} {stateBadge(s)}</div>
          </div>
          <input aria-label={`Start of season ${s.slug}`} type="date" value={s.starts_on || ''} onChange={(e) => changeSeason(s.id, 'starts_on', e.target.value)} className={inputClass} />
          <input aria-label={`End of season ${s.slug}`} type="date" value={s.ends_on || ''} onChange={(e) => changeSeason(s.id, 'ends_on', e.target.value)} className={inputClass} />
          <select aria-label={`Status of season ${s.slug}`} value={s.status} onChange={(e) => changeSeason(s.id, 'status', e.target.value)} className={inputClass}>{SEASON_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select aria-label={`Format of season ${s.slug}`} value={s.format} onChange={(e) => changeSeason(s.id, 'format', e.target.value)} className={inputClass}>{SEASON_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => saveSeason(s)} disabled={!!busy} className={ghostButton}><Save size={13} /> Save</button>
            <button type="button" onClick={() => chooseSeason(s)} disabled={!!busy} className={ghostButton}><Layers size={13} /> Sections</button>
            <button type="button" onClick={() => setRulesSeasonId(rulesSeasonId === s.id ? null : s.id)} disabled={!!busy} className={ghostButton}><ScrollText size={13} /> Rules</button>
            {!s.is_current && !s.archived_at && s.visibility === 'public' && <button type="button" onClick={() => makeCurrent(s)} disabled={!!busy} className={ghostButton}><Star size={13} /> Make current</button>}
            {lifecycleButtons(s, patchSeason)}
            {orderButtons(s.name, index, seasons.length, (offset) => reorder('seasons', seasons, index, offset))}
          </div>
        </li>)}</ul>}
    </section>}

    {selectedSeason && <section aria-label={`Sections of ${selectedSeason.name}`} className="space-y-3 rounded-2xl border border-white/10 bg-white/[.02] p-5">
      <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300">Sections of {selectedDivision?.name} {selectedSeason.name}</h3>
      {sectionsLoading && !sections.length ? <p className="text-zinc-500">Loading sections...</p> : !sections.length
        ? <p className="text-zinc-500">No section types are defined.</p>
        : <ul aria-label="Sections" className="space-y-2">{sections.map((sec, index) => <li key={sec.key} className="grid gap-2 rounded-xl border border-white/5 bg-black/30 p-3 lg:grid-cols-[1.2fr_auto_auto_90px_1.4fr_auto] lg:items-center">
          <div><label className={labelClass}>{sec.label} label<input value={sec.customLabel} placeholder={sec.label} maxLength={40} onChange={(e) => changeSection(sec.key, 'customLabel', e.target.value)} className={inputClass} /></label><p className="text-[10px] text-zinc-500">{sec.description}{!sec.saved && ' · default, not saved yet'}</p></div>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={sec.enabled} onChange={(e) => changeSection(sec.key, 'enabled', e.target.checked)} aria-label={`${sec.label} enabled`} /> Enabled</label>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={sec.nav_visible} onChange={(e) => changeSection(sec.key, 'nav_visible', e.target.checked)} aria-label={`${sec.label} in navigation`} /> In navigation</label>
          <div className="flex gap-1">{orderButtons(sec.label, index, sections.length, (offset) => setSections(move(sections, index, offset)))}</div>
          <input aria-label={`${sec.label} settings`} value={sec.settingsText} onChange={(e) => changeSection(sec.key, 'settingsText', e.target.value)} placeholder='Settings JSON, e.g. {"placement": "top"}' className={`${inputClass} font-mono text-xs`} />
        </li>)}</ul>}
      <button type="button" onClick={saveSections} disabled={!!busy || !sections.length || sectionsLoading} className={primaryButton}>
        <Check size={13} /> Save sections
      </button>
    </section>}

    {rulesSeason && <ManageRules key={rulesSeason.id} season={rulesSeason} />}
  </div>;
}
