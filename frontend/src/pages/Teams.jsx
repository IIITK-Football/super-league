import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLeague } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { Crest, EmptyState, ErrorState, Skeleton, Spotlight, Tabs } from '../components/ui';
import { MatchList } from '../components/match/MatchList';
import PlayerProfile from '../components/PlayerProfile';

// Squad order: goalkeepers, defenders, midfielders, forwards, then any other position, then unassigned players.
const POSITION_ORDER = [
  'GK', 'Goalkeepers',
  'CB', 'LB', 'RB', 'LWB', 'RWB', 'DEF', 'Defenders',
  'CDM', 'CM', 'CAM', 'LM', 'RM', 'MID', 'Midfielders',
  'LW', 'RW', 'CF', 'ST', 'FWD', 'Forwards', 'Attackers',
];
const POSITION_LABELS = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards', UNASSIGNED: 'Unassigned' };
const isUnassigned = (position) => !position || position.toUpperCase() === 'UNASSIGNED';

// Players grouped by position in squad order. Exported for tests.
export function groupSquad(players) {
  const groups = new Map();
  const place = (key, player) => groups.set(key, [...(groups.get(key) ?? []), player]);
  const known = new Map(POSITION_ORDER.map((p) => [p.toUpperCase(), p]));
  const unassigned = [];

  for (const player of players) {
    const raw = (player.position || '').trim();
    if (isUnassigned(raw)) unassigned.push(player);
    else place(known.get(raw.toUpperCase()) ?? raw, player);
  }

  const ordered = [...groups.entries()].sort(([a], [b]) => {
    const rank = (key) => (POSITION_ORDER.indexOf(key) === -1 ? POSITION_ORDER.length : POSITION_ORDER.indexOf(key));
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  // Players with a photo first, then by name.
  const byPhotoThenName = (a, b) => Number(Boolean(b.image_url)) - Number(Boolean(a.image_url)) || (a.name || '').localeCompare(b.name || '');
  if (unassigned.length) ordered.push(['UNASSIGNED', unassigned.sort(byPhotoThenName)]);
  return ordered.map(([key, list]) => ({ key, label: POSITION_LABELS[key] || key, players: list.sort(byPhotoThenName) }));
}

function SquadList({ players }) {
  const groups = useMemo(() => groupSquad(players), [players]);
  if (players.length === 0) {
    return <EmptyState title="No players yet">Players appear here once they are added to this club&apos;s squad.</EmptyState>;
  }
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label} className="space-y-3">
          <h3 className="eyebrow">{group.label}</h3>
          <ul className="glass divide-y divide-line/70 overflow-hidden rounded-card">
            {group.players.map((player) => (
              <li key={player.id}>
                <Link
                  to={`?player=${player.id}`}
                  className="flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-ink/[0.04] sm:px-5"
                >
                  <span className="w-9 shrink-0 text-right font-display text-3xl leading-none tabular-nums text-mut">{player.jersey_number ?? '-'}</span>
                  <span className="size-11 shrink-0 overflow-hidden rounded-full bg-raise">
                    {player.image_url && <img src={player.image_url} alt="" className="size-full object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-black uppercase tracking-tight text-ink">{player.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// One club: its matches this season and its squad. The club and tab are in the address.
function ClubPage({ team, teams, allPlayers, tab, setParams }) {
  const { seasonScope } = useLeague();
  const matchesApi = useApi(`/teams/${team.id}/matches`);
  const logos = new Map(teams.map((t) => [t.id, t.logo_url]));
  const matches = (matchesApi.data?.data ?? []).map((m) => ({
    ...m,
    home: { name: m.home_team, logo_url: logos.get(m.home_team_id) ?? null },
    away: { name: m.away_team, logo_url: logos.get(m.away_team_id) ?? null },
  }));
  const players = useMemo(() => allPlayers.filter((p) => p.team_id === team.id), [allPlayers, team.id]);

  return (
    <div className="space-y-10 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 items-center gap-5 sm:gap-8">
          <Crest name={team.name} src={team.logo_url} color={team.team_color} size="lg" className="size-24 sm:size-32" />
          <div className="min-w-0 space-y-2">
            <p className="eyebrow">{[seasonScope.divisionRecord?.name, seasonScope.season && `${seasonScope.season.name} season`].filter(Boolean).join(' · ')}</p>
            <h1 className="break-words font-display text-4xl text-ink sm:text-6xl">{team.name}</h1>
          </div>
        </div>
        <Link to={`/${seasonScope.division}/teams`} className="eyebrow inline-flex min-h-11 items-center hover:text-ink">All clubs</Link>
      </header>

      <Tabs
        label="Club sections"
        tabs={[{ id: 'matches', label: 'Matches' }, { id: 'squad', label: 'Squad' }]}
        value={tab}
        onChange={(next) => setParams(next === 'squad' ? { club: team.id, tab: 'squad' } : { club: team.id })}
      />

      {tab === 'squad' ? <SquadList players={players} />
        : matchesApi.loading ? <Skeleton className="h-36 w-full rounded-card" />
          : matchesApi.error ? <ErrorState message={matchesApi.error.message} onRetry={matchesApi.retry} />
            : matches.length === 0 ? <EmptyState title={`No matches for ${team.name} yet`}>Fixtures appear here once they are scheduled.</EmptyState>
              : <MatchList matches={matches} headingLevel={3} />}
    </div>
  );
}

// The clubs of the selected season. /teams lists them; /teams?club=<id> opens one; /teams?club=<id>&player=<id>
// opens a player from that squad. The address holds all of it, so back and shared links work.
export function Teams() {
  const { seasonScope } = useLeague();
  const { teamId } = useParams();
  const [params, setParams] = useSearchParams();
  const clubId = teamId ?? params.get('club');
  const playerId = params.get('player');
  const tab = params.get('tab') === 'squad' ? 'squad' : 'matches';

  const teamsApi = useApi('/teams');
  const playersApi = useApi('/players');
  const teams = useMemo(() => (teamsApi.data?.data ?? []).filter((t) => t.name), [teamsApi.data]);
  const allPlayers = playersApi.data?.data ?? [];

  if (playerId) {
    // PlayerProfile reads the player it shows from this entry, so it is set before the profile mounts.
    sessionStorage.setItem('selectedPlayer', JSON.stringify({ id: playerId }));
    return <PlayerProfile onBack={() => setParams(clubId ? { club: clubId } : {})} />;
  }

  const header = (
    <header className="space-y-2">
      <p className="eyebrow">{[seasonScope.divisionRecord?.name, seasonScope.season && `${seasonScope.season.name} season`].filter(Boolean).join(' · ') || ' '}</p>
      <h1 className="font-display text-4xl text-ink sm:text-6xl">Clubs</h1>
    </header>
  );

  if (teamsApi.loading) {
    return (
      <div aria-busy="true" aria-label="Loading clubs" className="space-y-10 pb-12">
        {header}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-56 w-full rounded-card" />)}
        </div>
      </div>
    );
  }

  if (teamsApi.error) {
    return <div className="space-y-10 pb-12">{header}<ErrorState message={teamsApi.error.message} onRetry={teamsApi.retry} /></div>;
  }

  if (clubId) {
    const team = teams.find((t) => t.id === clubId);
    if (!team) {
      return (
        <EmptyState title="Club not found">
          It is not in this season. <Link className="font-semibold text-ink underline underline-offset-4" to="/teams">See all clubs</Link>
        </EmptyState>
      );
    }
    return <ClubPage team={team} teams={teams} allPlayers={allPlayers} tab={tab} setParams={setParams} />;
  }

  if (teams.length === 0) {
    return <div className="space-y-10 pb-12">{header}<EmptyState title="No clubs in this season yet">Clubs appear here once teams are entered.</EmptyState></div>;
  }

  return (
    <div className="space-y-10 pb-12">
      {header}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((team) => {
          const playerCount = allPlayers.filter((p) => p.team_id === team.id).length;
          return (
            <li key={team.id}>
              <Spotlight
                as={Link}
                to={`/${seasonScope.division}/teams/${team.id}`}
                className="glass lift flex h-full flex-col items-center gap-4 rounded-card p-6 text-center"
                style={team.team_color ? { boxShadow: `inset 0 3px 0 ${team.team_color}` } : undefined}
              >
                <Crest name={team.name} src={team.logo_url} color={team.team_color} size="lg" className="size-24" />
                <span className="font-display text-2xl leading-none text-ink">{team.name}</span>
                {playersApi.data && <span className="eyebrow">{playerCount} {playerCount === 1 ? 'player' : 'players'}</span>}
              </Spotlight>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
