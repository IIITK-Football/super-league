import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useLeague } from '../context/LeagueContext';

// /<division> shows the division's current season; /<division>/<season> (for example /wsl/2027) shows that season.
// The address wins over a remembered choice, so a typed or shared link always opens the season it names.
export function DivisionHomeRoute({ division, children }) {
  const { setDivision, setSeasonSlug } = useLeague();
  const { season } = useParams();

  useEffect(() => {
    setDivision(division);
    setSeasonSlug(season || null, division);
  }, [division, season, setDivision, setSeasonSlug]);

  return children;
}
