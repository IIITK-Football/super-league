import { useEffect, useRef, useState } from 'react';
import { History, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// Dictator view of the append-only audit history: who changed what, when, in which table, with a safe summary of
// the change. Reads go straight to the Data API; row level security returns rows to dictators only, so anyone else
// sees an empty history. Nothing here can change the history.

export const AUDITED_TABLES = [
  { value: 'divisions', label: 'Divisions' },
  { value: 'seasons', label: 'Seasons' },
  { value: 'season_sections', label: 'Season sections' },
  { value: 'section_types', label: 'Section types' },
  { value: 'team_entries', label: 'Teams in seasons' },
  { value: 'user_roles', label: 'Roles' },
  { value: 'team_registrations', label: 'Captains' },
  { value: 'matches', label: 'Matches' },
  { value: 'goals', label: 'Goals' },
  { value: 'players', label: 'Players' },
  { value: 'roster_memberships', label: 'Rosters' },
  { value: 'player_private_details', label: 'Player contacts' },
];
export const PAGE_SIZE = 50;
const tableLabel = (name) => AUDITED_TABLES.find((t) => t.value === name)?.label ?? name;

const show = (value) => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

// One line per changed field: "field: from → to" for an update; the recorded values for an insert or delete.
export function summarize(entry) {
  const changes = entry.changes || {};
  const keys = Object.keys(changes).sort();
  if (entry.action === 'update') {
    return keys.map((k) => (changes[k]?.changed && !('from' in changes[k])
      ? `${k}: changed (private)`
      : `${k}: ${show(changes[k]?.from)} → ${show(changes[k]?.to)}`));
  }
  return keys.filter((k) => changes[k] !== null).map((k) => `${k}: ${show(changes[k])}`);
}

export function describeActor(entry, emails) {
  if (entry.actor_id) return emails[entry.actor_id] || entry.actor_id;
  if (entry.actor_role === 'service_role') return 'Server';
  return `System (${entry.actor_role})`;
}

const inputClass = 'w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[#d9ff4a]/60';
const labelClass = 'text-[10px] font-black uppercase tracking-widest text-zinc-500';
const ghostButton = 'flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-zinc-300 hover:bg-white/5 disabled:opacity-40';

export default function AuditHistory() {
  const [table, setTable] = useState('');
  const [actor, setActor] = useState('');
  const [actors, setActors] = useState([]);
  const [entries, setEntries] = useState([]);
  const [emails, setEmails] = useState({});
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  // Each load is numbered; only the newest one may update the list, so a slow answer for an old filter is dropped.
  const latestLoad = useRef(0);

  const load = async ({ append = false } = {}) => {
    setLoading(true);
    setError('');
    const from = append ? entries.length : 0;
    let query = supabase.from('audit_log')
      .select('id, occurred_at, actor_id, actor_role, action, table_name, record_id, changes')
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (table) query = query.eq('table_name', table);
    if (actor) query = query.eq('actor_id', actor);
    const request = ++latestLoad.current;
    const { data, error: err } = await query;
    if (request !== latestLoad.current) return;
    if (err) {
      setError(err.message || 'Could not load the audit history.');
      setLoading(false);
      return;
    }
    const rows = data || [];
    const next = append ? [...entries, ...rows] : rows;
    setEntries(next);
    setMore(rows.length === PAGE_SIZE);
    const unknown = [...new Set(rows.map((r) => r.actor_id).filter((id) => id && !emails[id]))];
    if (unknown.length) {
      const { data: profiles } = await supabase.from('user_profiles').select('id, email').in('id', unknown);
      setEmails((known) => ({ ...known, ...Object.fromEntries((profiles || []).map((p) => [p.id, p.email])) }));
    }
    if (request === latestLoad.current) setLoading(false);
  };

  // The actor filter offers the people who appear in the recent history.
  useEffect(() => {
    const ids = [...new Set(entries.map((e) => e.actor_id).filter(Boolean))];
    setActors((current) => [...new Set([...current, ...ids])]);
  }, [entries]);

  useEffect(() => { load(); }, [table, actor]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="space-y-6 p-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight"><History size={20} /> Audit history</h2>
        <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Who changed configuration, roles, captains, matches and rosters, and when. The history cannot be edited.</p>
      </div>
      <button type="button" onClick={() => load()} disabled={loading} className={ghostButton}><RefreshCw size={13} /> Refresh</button>
    </div>

    <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-5 md:grid-cols-2">
      <label className={labelClass}>Table
        <select aria-label="Table" value={table} onChange={(e) => setTable(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
          <option value="">All tables</option>
          {AUDITED_TABLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label className={labelClass}>Changed by
        <select aria-label="Changed by" value={actor} onChange={(e) => setActor(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>
          <option value="">Anyone</option>
          {actors.map((id) => <option key={id} value={id}>{emails[id] || id}</option>)}
        </select>
      </label>
    </div>

    {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

    {loading && !entries.length ? <p className="text-zinc-500">Loading the audit history...</p> : !entries.length && !error
      ? <p className="text-zinc-500">No changes recorded{table || actor ? ' for this filter' : ''} yet.</p>
      : <ol aria-label="Audit entries" className="space-y-2">{entries.map((e) => <li key={e.id} className="rounded-xl border border-white/5 bg-black/30 p-3 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <time dateTime={e.occurred_at} className="text-xs tabular-nums text-zinc-400">{new Date(e.occurred_at).toLocaleString()}</time>
          <span className="font-bold">{describeActor(e, emails)}</span>
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-zinc-300">{e.action}</span>
          <span className="text-zinc-300">{tableLabel(e.table_name)}</span>
          {e.record_id && <span className="font-mono text-[10px] text-zinc-500">{e.record_id}</span>}
        </div>
        <ul className="mt-1 space-y-0.5 font-mono text-xs text-zinc-400">{summarize(e).map((line) => <li key={line}>{line}</li>)}</ul>
      </li>)}</ol>}

    {more && <button type="button" onClick={() => load({ append: true })} disabled={loading} className={ghostButton}>
      {loading ? <Loader2 size={13} className="animate-spin" /> : null} Show older changes
    </button>}
  </div>;
}
