import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, CalendarPlus, Crown, History, Link2, PenLine, Radio } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Crest, NumberTicker, Skeleton } from '../../components/ui';
import { buttonClasses } from '../../components/ui/buttonClasses';
import { formatKickoff } from '../../components/admin/adminFormat';
import { cn } from '../../utils/cn';

const TEAM = 'name, logo_url, team_color';
const MATCH = `id, date, status, home_score, away_score, home:teams!home_team_id(${TEAM}), away:teams!away_team_id(${TEAM})`;
const count = (result) => (result.error ? null : (result.data ?? []).length);

// Reads only tables and functions the tools already use (row level security returns them to a dictator). Each figure
// loads on its own, so one that fails shows a dash and the rest still show.
async function loadOverview() {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86400000);
  const [live, fixtures, links, seasons, audit] = await Promise.all([
    supabase.from('matches').select(MATCH).eq('status', 'live').order('date', { ascending: true }),
    supabase.from('matches').select(MATCH).eq('status', 'scheduled').gte('date', now.toISOString()).lt('date', week.toISOString()).order('date', { ascending: true }),
    supabase.rpc('account_link_matches'),
    supabase.from('seasons').select('id').eq('is_current', true),
    supabase.from('audit_log').select('id, occurred_at, action, table_name').order('occurred_at', { ascending: false }).limit(5),
  ]);
  // Team entries of the current seasons that have no captain.
  const seasonIds = (seasons.data ?? []).map((s) => s.id);
  let uncaptained = seasons.error ? null : 0;
  if (seasonIds.length) {
    const [entries, captains] = await Promise.all([
      supabase.from('team_entries').select('id').in('season_id', seasonIds),
      supabase.from('captain_assignments').select('team_entry_id'),
    ]);
    const held = new Set((captains.data ?? []).map((c) => c.team_entry_id));
    uncaptained = entries.error || captains.error ? null : entries.data.filter((e) => !held.has(e.id)).length;
  }
  return {
    live: live.data ?? [],
    liveCount: count(live),
    fixtures: fixtures.data ?? [],
    fixtureCount: count(fixtures),
    readyLinks: links.error ? null : (links.data ?? []).filter((row) => row.status === 'ready').length,
    uncaptained,
    audit: audit.data ?? [],
  };
}

function Stat({ to, icon: Icon, label, value, note, live }) {
  return (
    <Link to={to} className={cn('glass lift group flex min-h-32 flex-col justify-between gap-3 rounded-card p-4 sm:min-h-36 sm:p-5', live && 'beam')}>
      <span className="flex items-center justify-between">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.07] text-ink"><Icon size={17} aria-hidden="true" /></span>
          <span className="eyebrow truncate">{label}</span>
        </span>
        <ArrowUpRight size={16} aria-hidden="true" className="text-mut transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </span>
      <span className="flex items-end gap-3">
        <span className="chrome font-display text-4xl tabular-nums sm:text-5xl leading-none text-ink">{value === null ? '-' : <NumberTicker value={value} />}</span>
        {live && value > 0 && <span className="relative mb-2 flex size-2.5"><span className="absolute inset-0 rounded-full bg-live motion-safe:animate-ping" /><span className="relative size-2.5 rounded-full bg-live" /></span>}
      </span>
      <span className="text-xs text-mut sm:text-sm">{note}</span>
    </Link>
  );
}

function MatchRow({ match }) {
  const live = match.status === 'live';
  return (
    <li className="flex items-center gap-3 py-3">
      <Crest name={match.home?.name} src={match.home?.logo_url} color={match.home?.team_color} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm font-black uppercase tracking-tight text-ink">{match.home?.name ?? 'Home'} <span className="text-mut">v</span> {match.away?.name ?? 'Away'}</span>
      <Crest name={match.away?.name} src={match.away?.logo_url} color={match.away?.team_color} size="sm" />
      <span className="w-28 shrink-0 text-right text-xs tabular-nums text-mut">
        {live ? <span className="inline-flex items-center gap-2 font-display text-base text-ink"><span className="size-1.5 rounded-full bg-live motion-safe:animate-pulse-dot" />{match.home_score ?? 0} - {match.away_score ?? 0}</span> : formatKickoff(match.date)}
      </span>
    </li>
  );
}

const ACTIONS = [
  { to: '/dictator/live', label: 'Start live match', icon: Radio },
  { to: '/dictator/fixtures#add-fixture', label: 'Add fixture', icon: CalendarPlus },
  { to: '/dictator/news#write-news', label: 'Write news', icon: PenLine },
];

export function Overview() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    loadOverview().then((result) => { if (alive) setData(result); }, () => { if (alive) setData({ live: [], fixtures: [], audit: [], liveCount: null, fixtureCount: null, readyLinks: null, uncaptained: null }); });
    return () => { alive = false; };
  }, []);

  const matches = data ? [...data.live, ...data.fixtures].slice(0, 6) : [];
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map(({ to, label, icon: Icon }, i) => (
          <Link key={to} to={to} className={buttonClasses(i === 0 ? 'primary' : 'secondary', 'md')}><Icon size={16} aria-hidden="true" />{label}</Link>
        ))}
      </div>

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {!data ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-card" />) : <>
          <Stat to="/dictator/live" icon={Radio} label="Live now" value={data.liveCount} live note={data.liveCount ? 'Open the live desk to score them.' : 'Nothing is being played.'} />
          <Stat to="/dictator/fixtures" icon={CalendarDays} label="Next 7 days" value={data.fixtureCount} note="Fixtures still to kick off." />
          <Stat to="/dictator/captains" icon={Crown} label="No captain" value={data.uncaptained} note="Teams in current seasons." />
          <Stat to="/dictator/teams" icon={Link2} label="Links ready" value={data.readyLinks} note="Players ready to join their accounts." />
        </>}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="ov-matches" className="glass rounded-card p-5">
          <div className="flex items-center justify-between">
            <h2 id="ov-matches" className="font-display text-2xl text-ink">This week</h2>
            <Link to="/dictator/fixtures" className="eyebrow inline-flex min-h-11 items-center gap-1 hover:text-ink">Fixtures <ArrowUpRight size={13} aria-hidden="true" /></Link>
          </div>
          {!data ? <Skeleton className="mt-3 h-40" /> : matches.length
            ? <ul className="divide-y divide-line/70">{matches.map((m) => <MatchRow key={m.id} match={m} />)}</ul>
            : <div className="flex flex-col items-start gap-3 py-6 text-sm text-mut">
                <CalendarPlus size={28} aria-hidden="true" className="text-mut" />
                No matches in the next seven days.
                <Link to="/dictator/fixtures#add-fixture" className={buttonClasses('secondary', 'sm')}>Add a fixture</Link>
              </div>}
        </section>

        <section aria-labelledby="ov-audit" className="glass rounded-card p-5">
          <div className="flex items-center justify-between">
            <h2 id="ov-audit" className="font-display text-2xl text-ink">Latest changes</h2>
            <Link to="/dictator/audit" className="eyebrow inline-flex min-h-11 items-center gap-1 hover:text-ink">History <ArrowUpRight size={13} aria-hidden="true" /></Link>
          </div>
          {!data ? <Skeleton className="mt-3 h-40" /> : data.audit.length
            ? <ol className="divide-y divide-line/70">{data.audit.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-3 text-sm">
                  <History size={15} aria-hidden="true" className="shrink-0 text-mut" />
                  <span className="min-w-0 flex-1 truncate text-ink"><span className="font-semibold capitalize">{e.action}</span> {e.table_name.replaceAll('_', ' ')}</span>
                  <time dateTime={e.occurred_at} className="shrink-0 text-xs tabular-nums text-mut">{formatKickoff(e.occurred_at)}</time>
                </li>))}</ol>
            : <p className="py-6 text-sm text-mut">No changes recorded yet.</p>}
        </section>
      </div>
    </div>
  );
}
