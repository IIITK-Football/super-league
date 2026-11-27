import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { History, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Combobox, Field, Notice, Select } from '../ui';

const ACTION_ICON = { insert: Plus, update: Pencil, delete: Trash2 };

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
  { value: 'captain_assignments', label: 'Captain assignments' },
  { value: 'scorer_assignments', label: 'Scorer assignments' },
  { value: 'team_registrations', label: 'Captains (earlier registrations)' },
  { value: 'matches', label: 'Matches' },
  { value: 'goals', label: 'Goals' },
  { value: 'players', label: 'Players' },
  { value: 'roster_memberships', label: 'Rosters' },
  { value: 'player_link_keys', label: 'Player account matching (no addresses shown)' },
  { value: 'player_private_details', label: 'Player contacts (before accounts)' },
];
export const PAGE_SIZE = 50;
const tableLabel = (name) => AUDITED_TABLES.find((t) => t.value === name)?.label ?? name;

const show = (value) => {
  if (value === null || value === undefined) return '-';
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

// A person is shown by the label from audit_actors (name, else email, else "Deleted or unavailable account"), never by
// a raw id; until the labels arrive, or if they could not be loaded, a neutral placeholder stands in.
export const UNKNOWN_ACCOUNT = 'Unknown account';
export function describeActor(entry, labels) {
  if (entry.actor_id) return labels[entry.actor_id] || UNKNOWN_ACCOUNT;
  if (entry.actor_role === 'service_role') return 'Server';
  if (entry.actor_role === 'auto-link') return 'Automatic link (email verified)';
  return `System (${entry.actor_role})`;
}


export default function AuditHistory() {
  const [table, setTable] = useState('');
  const [actor, setActor] = useState('');
  // Everyone in the whole history (not only the loaded page), from the dictator-only audit_actors function.
  const [actors, setActors] = useState([]);
  const [actorsState, setActorsState] = useState('loading');
  const [entries, setEntries] = useState([]);
  const [labels, setLabels] = useState({});
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
    if (request === latestLoad.current) setLoading(false);
  };

  const loadActors = async () => {
    setActorsState('loading');
    const { data, error: err } = await supabase.rpc('audit_actors');
    if (err) { setActorsState('error'); return; }
    const list = data || [];
    setActors(list);
    setLabels(Object.fromEntries(list.map((a) => [a.actor_id, a.label])));
    setActorsState('ready');
  };
  useEffect(() => { loadActors(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Someone new since the people list was loaded (for example after Refresh): reload the list, once per person.
  const askedFor = useRef(new Set());
  useEffect(() => {
    if (actorsState !== 'ready') return;
    const missing = entries.map((e) => e.actor_id).filter((id) => id && !labels[id] && !askedFor.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => askedFor.current.add(id));
    loadActors();
  }, [entries, labels, actorsState]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [table, actor]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="space-y-6">
    <div className="glass grid gap-4 rounded-card p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <Field label="Table">{(p) => <Select {...p} aria-label="Table" value={table} onChange={setTable}
        options={[{ value: '', label: 'All tables' }, ...AUDITED_TABLES]} />}</Field>
      <Field label="Changed by">{(p) => <Combobox {...p} aria-label="Changed by" value={actor} onChange={setActor} disabled={actorsState !== 'ready'}
        placeholder={actorsState === 'loading' ? 'Loading people...' : 'Anyone'} searchPlaceholder="Search people"
        options={[{ value: '', label: 'Anyone' }, ...actors.map((a) => ({ value: a.actor_id, label: a.label }))]} />}</Field>
      <Button variant="secondary" onClick={() => load()} disabled={loading}><RefreshCw size={15} aria-hidden="true" />Refresh</Button>
      {actorsState === 'error' && <Notice tone="warning" role="status" className="md:col-span-3">
        The people list could not be loaded, so the history cannot be filtered by person. <Button variant="quiet" size="sm" onClick={loadActors}>Try again</Button>
      </Notice>}
    </div>

    {error && <Notice tone="error" role="alert">{error}</Notice>}

    {loading && !entries.length ? <p className="text-sm text-mut">Loading the audit history...</p> : !entries.length && !error
      ? <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-6 text-sm text-mut">
          <History size={26} aria-hidden="true" />
          No changes recorded{table || actor ? ' for this filter' : ''} yet.
        </div>
      : <ol aria-label="Audit entries" className="glass divide-y divide-line/70 rounded-card px-2">{entries.map((e) => {
        const Icon = ACTION_ICON[e.action] ?? History;
        return <li key={e.id} className="flex gap-3 p-3 text-sm">
          <span aria-hidden="true" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-ink/[0.07] text-ink"><Icon size={15} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-semibold text-ink">{describeActor(e, labels)}</span>
              <span className="text-mut">{e.action}</span>
              <span className="font-semibold text-ink">{tableLabel(e.table_name)}</span>
              <time dateTime={e.occurred_at} className="ml-auto text-xs tabular-nums text-mut">{new Date(e.occurred_at).toLocaleString()}</time>
            </div>
            {e.record_id && <p className="font-mono text-xs text-mut/80">{e.record_id}</p>}
            <ul className="mt-1.5 space-y-0.5 break-words font-mono text-xs text-mut">{summarize(e).map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        </li>;
      })}</ol>}

    {more && <div><Button variant="secondary" onClick={() => load({ append: true })} disabled={loading}>{loading ? 'Loading...' : 'Show older changes'}</Button></div>}
  </div>;
}
