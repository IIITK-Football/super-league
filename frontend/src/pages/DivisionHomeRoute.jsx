import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLeague } from '../context/LeagueContext';
import { SectionGate } from './SectionGate';

export function DivisionHomeRoute({ children }) {
  const { division, season } = useParams();
  const { setDivision, setSeasonSlug, seasonScope } = useLeague();

  useEffect(() => {
    setDivision(division);
    setSeasonSlug(season || null, division);
  }, [division, season, setDivision, setSeasonSlug]);

  if (!division || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(division)) return <p role="status">Division not found.</p>;
  if (!seasonScope.ready || seasonScope.division !== division
    || seasonScope.requestedSeasonSlug !== (season && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(season) ? season : null)) {
    return <p role="status">Loading seasons…</p>;
  }
  if (seasonScope.error) return <p role="alert">The division could not be loaded.</p>;
  if (!seasonScope.divisionRecord) return <p role="status">Division not found.</p>;
  if (season && (!seasonScope.season || seasonScope.season.slug !== season)) {
    return <section className="space-y-2">
      <h1 className="text-xl font-bold">Season not found</h1>
      <p>There is no season &quot;{season}&quot; in {seasonScope.divisionRecord.name}.</p>
      <Link className="underline" to={`/${division}`}>{seasonScope.currentSeason ? 'Go to the current season' : 'View the division'}</Link>
    </section>;
  }
  if (seasonScope.season) return <SectionGate section="overview">{children}</SectionGate>;

  const { divisionRecord, seasons } = seasonScope;
  return <section className="mx-auto max-w-4xl space-y-4 px-6">
    <h1 className="text-3xl font-bold" style={{ color: divisionRecord.primary_color || undefined }}>{divisionRecord.name}</h1>
    {seasons.length === 0 ? <p>No public seasons yet.</p> : <>
      <h2 className="font-semibold">Choose a season</h2>
      <ul className="space-y-2">{seasons.map((item) => <li key={item.id}>
        <Link className="underline" to={`/${division}/${item.slug}`}>{item.name}</Link>
      </li>)}</ul>
    </>}
  </section>;
}
