import { MatchStrip } from './MatchStrip';
import { dayLabel, groupByDate } from './matchState';

// Matches under a heading per day. The caller orders them; each day keeps that order.
export function MatchList({ matches, headingLevel = 3 }) {
  const Heading = `h${headingLevel}`;
  return (
    <div className="space-y-6">
      {groupByDate(matches).map((group) => (
        <section key={group.key} aria-label={dayLabel(group.date)} className="space-y-3">
          <Heading className="font-display text-lg font-bold text-ink">{dayLabel(group.date)}</Heading>
          <ul className="space-y-3">
            {group.matches.map((match) => (
              <li key={match.id}><MatchStrip match={match} /></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
