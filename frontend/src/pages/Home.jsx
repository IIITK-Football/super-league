import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useLeague } from '../context/LeagueContext';
import { useApi } from '../hooks/useApi';
import { SeasonSelect } from '../components/SeasonSelect';
import { MatchStrip } from '../components/match/MatchStrip';
import { HeroMatch } from '../components/match/HeroMatch';
import { isFinal, pickHeroMatch } from '../components/match/matchState';
import { StandingsTable } from '../components/standings/StandingsTable';
import { NewsArticle } from '../components/NewsArticle';
import { EmptyState, ErrorState, NumberTicker, Skeleton, Spotlight } from '../components/ui';

// The team object of a match, with its crest taken from the table (the schedule does not carry logos).
const withLogo = (team, teamId, logos) => ({ ...(Array.isArray(team) ? team[0] : team), logo_url: logos.get(teamId) ?? null });
const HERO_LABEL = { live: 'Live now', next: 'Next match', result: 'Latest result' };
const time = (m) => (m.date ? new Date(m.date).getTime() : 0);

function SectionHead({ title, to, action }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <h2 className="font-display text-2xl text-ink sm:text-4xl">{title}</h2>
      {to && (
        <Link to={to} className="eyebrow group inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap hover:text-ink">
          {action}
          <ArrowRight size={13} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading this division" className="space-y-12">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Skeleton className="h-72 w-full rounded-card sm:h-96" />
        <Skeleton className="h-72 w-full rounded-card sm:h-96" />
      </div>
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32 w-80 shrink-0 rounded-card" />)}
      </div>
    </div>
  );
}

// The matches around today, for the rail under the hero: live first, then the next fixtures, then recent results.
function railMatches(matches, hero) {
  return matches.filter((m) => m.id !== hero?.match.id && isFinal(m))
    .sort((a, b) => time(b) - time(a)).slice(0, 4);
}

// A leader tile: the number counts up, the name links to the player.
function Leader({ label, unit, player }) {
  const name = <span className="block font-display text-2xl leading-none text-ink sm:text-3xl">{player.name}</span>;
  return (
    <Spotlight className="glass lift flex flex-col justify-between gap-6 rounded-card p-5 sm:p-6">
      <div className="space-y-3">
        <p className="eyebrow">{label}</p>
        {player.playerId ? <Link to={`/teams?player=${player.playerId}`} className="block hover:opacity-80">{name}</Link> : name}
        {player.club && <p className="text-sm font-semibold uppercase tracking-wider text-mut">{player.club}</p>}
      </div>
      <p className="flex items-baseline gap-2">
        <NumberTicker value={player.stat} className="chrome font-display text-7xl leading-none tabular-nums text-ink" />
        <span className="eyebrow">{unit}</span>
      </p>
    </Spotlight>
  );
}

function NewsCarousel({ articles, division }) {
  const stage = useRef(null);
  const angle = useRef(0);
  const target = useRef(null);
  const touch = useRef(null);
  const swiped = useRef(false);
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [interacting, setInteracting] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [stepping, setStepping] = useState(false);
  const multiple = articles.length > 1;

  const positionCards = useCallback(() => {
    const container = stage.current;
    if (!container) return;
    const radius = Math.min(container.clientWidth * 0.39, 390);
    [...container.children].forEach((card, index) => {
      const theta = index * Math.PI * 2 / articles.length - angle.current;
      const depth = (Math.cos(theta) + 1) / 2;
      const x = Math.sin(theta) * radius;
      const y = (1 - depth) * 42;
      const scale = 0.72 + depth * 0.28;
      const hidden = depth < 0.12;
      const fade = Math.min(1, Math.max(0, (depth - 0.12) / 0.3));
      card.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
      card.style.opacity = String(fade * (0.55 + depth * 0.45));
      card.style.zIndex = String(Math.round(depth * 100));
      card.style.pointerEvents = hidden ? 'none' : '';
      card.setAttribute('aria-hidden', String(hidden));
      card.querySelector('a')?.setAttribute('tabindex', hidden ? '-1' : '0');
    });
  }, [articles.length]);

  useLayoutEffect(() => {
    positionCards();
    window.addEventListener('resize', positionCards);
    return () => window.removeEventListener('resize', positionCards);
  }, [positionCards]);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !stage.current) return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  const move = (direction) => {
    const step = Math.PI * 2 / articles.length;
    target.current = (Math.round(angle.current / step) + direction) * step;
    if (reduced) { angle.current = target.current; target.current = null; positionCards(); }
    else setStepping(true);
  };

  useEffect(() => {
    const autoplay = multiple && !stopped && !interacting && !reduced && visible;
    if (!autoplay && !stepping) return undefined;
    let frame;
    let last;
    const animate = (now) => {
      const elapsed = last === undefined ? 0 : Math.min(now - last, 50);
      last = now;
      if (target.current !== null) {
        const difference = target.current - angle.current;
        angle.current += difference * (1 - Math.exp(-elapsed / 260));
        if (Math.abs(difference) < 0.001) { angle.current = target.current; target.current = null; setStepping(false); }
      } else if (autoplay && !document.hidden) {
        angle.current += elapsed * Math.PI * 2 / (articles.length * 14000);
      }
      positionCards();
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [articles.length, multiple, stopped, interacting, reduced, visible, stepping, positionCards]);

  return <section className="min-w-0 space-y-4" aria-label="News carousel" aria-roledescription="carousel"
    onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)}
    onFocusCapture={() => { setStopped(true); setInteracting(true); }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <SectionHead title="News" to={`/${division}/news`} action="All news" />
      {multiple && <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous news" onClick={() => move(-1)} className="glass rounded-full p-3"><ArrowLeft size={16} /></button>
        <button type="button" aria-label="Next news" onClick={() => move(1)} className="glass rounded-full p-3"><ArrowRight size={16} /></button>
      </div>}
    </div>
    <ul ref={stage} className="relative isolate h-[23rem] overflow-hidden sm:h-[27rem]" style={{ touchAction: 'pan-y' }}
      onTouchStart={(event) => { touch.current = event.touches[0].clientX; setStopped(true); setInteracting(true); }}
      onTouchEnd={(event) => {
        const delta = event.changedTouches[0].clientX - touch.current;
        if (multiple && Math.abs(delta) > 35) {
          swiped.current = true; move(delta < 0 ? 1 : -1);
          window.setTimeout(() => { swiped.current = false; }, 500);
        }
        touch.current = null; setInteracting(false);
      }}
      onClickCapture={(event) => { if (swiped.current) { event.preventDefault(); swiped.current = false; } }}>
      {articles.map((article) => <li key={article.id} className="absolute left-1/2 top-1/2 w-[min(68%,19rem)] origin-center rounded-card bg-surf shadow-2xl will-change-transform">
        <Link to={`/article/${article.id}`} className="block rounded-card"><NewsArticle article={article} /></Link>
      </li>)}
    </ul>
  </section>;
}

// The division's front page. Above the fold: the live (else next, else latest) match on a night pitch, with the
// table beside it. Then the matches around today, the leaders and the news. Modules with no data are left out.
export function Home() {
  const { division, seasonScope } = useLeague();
  const navigate = useNavigate();
  // Requests wait for the chosen season; an unknown season is reported below and nothing is requested.
  const board = useApi(seasonScope.seasonMissing ? null : '/standings');
  const extras = useApi(seasonScope.seasonMissing ? null : '/home/dashboard');

  // Choosing a season puts it in the address (/wsl/2027), so the page can be shared; the current season is plain /wsl.
  const chooseSeason = (slug) => {
    const current = seasonScope.currentSeason;
    navigate(slug === current?.slug ? `/${division}` : `/${division}/${slug}`);
  };

  if (seasonScope.seasonMissing) {
    return (
      <div className="flex min-h-[50vh] flex-col items-start justify-center gap-3">
        <h1 className="font-display text-4xl text-ink">Season not found</h1>
        <p className="text-mut">There is no season &quot;{seasonScope.requestedSeasonSlug}&quot; in {seasonScope.divisionRecord?.name || 'this division'}.</p>
        <Link to={`/${division}`} className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4">
          Go to the current season
        </Link>
      </div>
    );
  }

  const divisionName = seasonScope.divisionRecord?.name;
  const season = seasonScope.season;
  const header = (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
      <h1 className="eyebrow">
        <span className="text-ink">{divisionName}</span>
        {season && <span> · {season.name} season</span>}
      </h1>
      {seasonScope.seasons.length > 1 && (
        <SeasonSelect seasons={seasonScope.seasons} value={season?.slug} onChange={chooseSeason} />
      )}
    </div>
  );

  if (!seasonScope.ready || board.loading) {
    return <div className="pb-12">{header}<div className="mt-5"><HomeSkeleton /></div></div>;
  }

  if (board.error) {
    return (
      <div className="pb-12">
        {header}
        <div className="mt-5"><ErrorState message={board.error.message} onRetry={board.retry} /></div>
      </div>
    );
  }

  const payload = board.data?.data ?? {};
  const table = payload.standings ?? [];
  const logos = new Map(table.map((row) => [row.teamId, row.logoUrl]));
  const matches = (payload.bracketMatches ?? []).map((m) => ({
    ...m,
    home: withLogo(m.home, m.home_team_id, logos),
    away: withLogo(m.away, m.away_team_id, logos),
  }));
  const selected = pickHeroMatch(matches);
  const hero = selected?.kind === 'result' ? null : selected;
  const rail = railMatches(matches, hero);

  const extraData = extras.data?.data ?? {};
  // The dashboard's live match carries form and scorers; use it only when it is the same fixture as the hero.
  const liveDetail = extraData.liveMatch;
  const heroHome = hero && (Array.isArray(hero.match.home) ? hero.match.home[0] : hero.match.home)?.name;
  const detail = liveDetail && heroHome && liveDetail.homeTeam === heroHome ? liveDetail : null;
  const news = extraData.news ?? [];
  const leaders = [
    extraData.topScorer && { key: 'scorer', label: 'Golden boot', unit: 'goals', player: extraData.topScorer },
    extraData.topAssist && { key: 'assist', label: 'Playmaker', unit: 'assists', player: extraData.topAssist },
  ].filter(Boolean);
  const predictions = (extraData.fantasyTop ?? []).slice(0, 5);

  const nothingYet = !hero && table.length === 0 && !extras.loading && !extras.error
    && news.length === 0 && leaders.length === 0 && predictions.length === 0;

  return (
    <div className="pb-12">
      {header}
      <div className="mt-5 space-y-14">
      <div className="space-y-5">
        {nothingYet && (
          <EmptyState title="Nothing published for this season yet">
            Matches, the table, news and predictions appear here as they are added.
          </EmptyState>
        )}

        {(hero || rail.length > 0 || table.length > 0) && (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-5">
              {hero && <section aria-label={HERO_LABEL[hero.kind]}><HeroMatch match={hero.match} detail={detail} /></section>}
      {rail.length > 0 && (
        <section className="space-y-4">
          <SectionHead title="Recent matches" to={`/${division}/matches`} action="View all" />
          <ul className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
            {rail.map((m) => (
              <li key={m.id} className="w-[min(85%,16rem)] shrink-0 snap-start">
                <MatchStrip match={m} className="h-full !p-3" />
              </li>
            ))}
          </ul>
        </section>
      )}
            </div>
            {table.length > 0 && (
              <section className="space-y-3">
                <SectionHead title="Table" to={`/standings/${division}`} action="Full table" />
                <StandingsTable rows={table.slice(0, 6)} caption="Top of the table" compact />
              </section>
            )}
          </div>
        )}
      </div>



      {extras.error && (
        <ErrorState title="News, stats and predictions did not load" message={extras.error.message} onRetry={extras.retry} />
      )}

      {news.length > 0 && <NewsCarousel articles={news} division={division} />}

      {(leaders.length > 0 || predictions.length > 0) && (
        <section className="space-y-4">
          <SectionHead title="Leaders" to="/leaderboard" action="Player stats" />
          <div className="grid gap-4 md:grid-cols-3">
            {leaders.map(({ key, ...rest }) => <Leader key={key} {...rest} />)}
            {predictions.length > 0 && (
              <Spotlight className="glass rounded-card p-5 sm:p-6">
                <div className="mb-3 flex items-center justify-between">
                  <p className="eyebrow">Predictions</p>
                  <Link to="/fantasy" className="eyebrow hover:text-ink">Table</Link>
                </div>
                <ol className="divide-y divide-line/70">
                  {predictions.map((user, index) => (
                    <li key={user.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="w-4 shrink-0 font-display text-mut tabular-nums">{index + 1}</span>
                        <span className="truncate font-bold uppercase tracking-tight text-ink">{user.name}</span>
                      </span>
                      <span className="shrink-0 font-display text-xl tabular-nums text-ink">{user.points.toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
              </Spotlight>
            )}
          </div>
        </section>
      )}

      </div>
    </div>
  );
}
