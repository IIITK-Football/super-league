import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useLeague } from '../context/LeagueContext';

export function SectionGate({ section, children }) {
  const { seasonScope, setDivision, setSeasonSlug } = useLeague();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const { division: routeDivision } = useParams();
  const explicitDivision = params.get('division');
  const division = routeDivision || explicitDivision;
  const season = params.get('season') || null;

  useEffect(() => {
    if (!division) return;
    setDivision(division);
    if (explicitDivision) setSeasonSlug(season, division);
  }, [division, explicitDivision, season, setDivision, setSeasonSlug]);

  if (division && (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(division)
    || (season && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(season)))) {
    return <p role="status" className="p-6">Season not found.</p>;
  }
  if (!seasonScope.ready || (division && (division !== seasonScope.division || (explicitDivision && season !== seasonScope.requestedSeasonSlug)))) {
    return <p role="status" className="p-6">Loading seasons…</p>;
  }
  if (seasonScope.error) return <p role="alert" className="p-6">The season could not be loaded.</p>;
  const available = seasonScope.sections.find((item) => item.key === section)?.enabled;
  if (!available) return <p role="status" className="p-6">This section is not available for this season.</p>;
  return children;
}
