import { MatchStrip } from './MatchStrip';
import { dayLabel, groupByDate } from './matchState';

// Matches under an eyebrow date per day. On laptops the date sits beside its tiles; a day with one match gives it the
// whole row. Tiles are 1 column on phones, 2 on tablets, 3 on laptops. The caller orders the matches; each day keeps it.
export function MatchList({ matches, headingLevel = 3 }) {
  const Heading = `h${headingLevel}`;
  return (
    <div className="space-y-8">
      {groupByDate(matches).map((group) => (
        <section key={group.key} aria-label={dayLabel(group.date)} className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
          <Heading className="eyebrow">{dayLabel(group.date)}</Heading>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 *:only:col-span-full">
            {group.matches.map((match) => (
              <li key={match.id}><MatchStrip match={match} className="h-full" /></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
