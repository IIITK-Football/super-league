import { Fragment, useState } from 'react';
import { cn } from '../../utils/cn';
import { FormGuide } from '../FormGuide';

// A missing number shows a dash, never a zero.
const shown = (value) => (value === null || value === undefined ? '-' : value);
const signed = (value) => (typeof value === 'number' && value > 0 ? `+${value}` : shown(value));

// Phones: position, club, played, goal difference, points and form. Tap a club to see the rest of its line.
// Laptops: every column, with the club name kept in view while the table scrolls sideways.
// compact (the division home's side column): position, club, goal difference and points only.
export function StandingsTable({ rows, caption = 'League table', compact = false }) {
  const [open, setOpen] = useState(null);
  const extra = compact ? 'hidden' : 'hidden md:table-cell';
  const notCompact = compact ? 'hidden' : '';

  return (
    <div className="glass overflow-x-auto rounded-card">
      <table className={cn('w-full border-collapse text-sm tabular-nums', compact ? '' : 'min-w-[16rem] md:min-w-[46rem]')}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.2em] text-mut">
            <th scope="col" className="w-9 px-0.5 py-2.5 text-center font-semibold sm:w-12 sm:px-3">Pos</th>
            <th scope="col" className="sticky left-0 z-[1] bg-surf py-3 pl-1 pr-1 font-black sm:pl-2 md:left-12 md:px-2">Club</th>
            <th scope="col" className={cn(notCompact, 'px-0.5 py-2.5 text-center font-black sm:px-2')}><abbr title="Played">P</abbr></th>
            <th scope="col" className={cn(extra, 'px-2 py-2.5 text-center font-semibold')}><abbr title="Won">W</abbr></th>
            <th scope="col" className={cn(extra, 'px-2 py-2.5 text-center font-semibold')}><abbr title="Drawn">D</abbr></th>
            <th scope="col" className={cn(extra, 'px-2 py-2.5 text-center font-semibold')}><abbr title="Lost">L</abbr></th>
            <th scope="col" className={cn(extra, 'px-2 py-2.5 text-center font-semibold')}><abbr title="Goals for">GF</abbr></th>
            <th scope="col" className={cn(extra, 'px-2 py-2.5 text-center font-semibold')}><abbr title="Goals against">GA</abbr></th>
            <th scope="col" className="px-0.5 py-2.5 text-center font-semibold sm:px-2"><abbr title="Goal difference">GD</abbr></th>
            <th scope="col" className="px-0.5 py-2.5 text-center font-semibold sm:px-2"><abbr title="Points">Pts</abbr></th>
            <th scope="col" className={cn(notCompact, 'px-0.5 py-2.5 font-black sm:px-2')}><span className="sm:hidden">Form</span><span className="hidden sm:inline">Last five</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((team, index) => {
            const s = team.stats || {};
            const id = `standing-${team.teamId}`;
            const expanded = open === team.teamId;
            return (
              <Fragment key={team.teamId}>
                <tr className="border-b border-line/70 transition-colors last:border-0 hover:bg-ink/[0.035]">
                  <td className="px-0.5 py-3 text-center font-display text-lg text-mut sm:px-3">{team.rank ?? index + 1}</td>
                  <th scope="row" className="sticky left-0 z-[1] bg-surf py-2 pl-1 pr-1 text-left font-normal sm:pl-2 md:left-12 md:px-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={id}
                      onClick={() => setOpen(expanded ? null : team.teamId)}
                      className="flex min-h-11 w-full items-center gap-2 text-left md:cursor-default"
                    >
                      {team.logoUrl && <img src={team.logoUrl} alt="" className="size-6 shrink-0 object-contain" />}
                      <span className="min-w-0 text-[13px] font-black uppercase leading-tight tracking-tight text-ink sm:text-sm">{team.teamName}</span>
                    </button>
                  </th>
                  <td className={cn(notCompact, 'px-0.5 py-3 text-center text-mut sm:px-2')}>{shown(s.matchesPlayed)}</td>
                  <td className={cn(extra, 'px-2 py-3 text-center text-mut')}>{shown(s.won)}</td>
                  <td className={cn(extra, 'px-2 py-3 text-center text-mut')}>{shown(s.drawn)}</td>
                  <td className={cn(extra, 'px-2 py-3 text-center text-mut')}>{shown(s.lost)}</td>
                  <td className={cn(extra, 'px-2 py-3 text-center text-mut')}>{shown(s.goalsFor)}</td>
                  <td className={cn(extra, 'px-2 py-3 text-center text-mut')}>{shown(s.goalsAgainst)}</td>
                  <td className="px-0.5 py-3 text-center font-semibold text-mut sm:px-2">{signed(s.goalDifference)}</td>
                  <td className="px-1 py-3 text-center font-display text-xl text-ink sm:px-3 sm:text-2xl">{shown(s.points)}</td>
                  <td className={cn(notCompact, 'px-0.5 py-3 sm:px-2')}>
                    <span className="sm:hidden"><FormGuide form={(team.form || []).slice(-3)} /></span>
                    <span className="hidden sm:inline-flex"><FormGuide form={(team.form || []).slice(-5)} /></span>
                  </td>
                </tr>
                <tr id={id} hidden={!expanded} className={cn('border-b border-line bg-raise/40', compact ? 'hidden' : 'md:hidden')}>
                  <td colSpan={5} className="px-3 py-3">
                    <dl className="grid grid-cols-5 gap-2 text-center">
                      {[['W', s.won], ['D', s.drawn], ['L', s.lost], ['GF', s.goalsFor], ['GA', s.goalsAgainst]].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-xs text-mut">{label}</dt>
                          <dd className="font-display text-lg font-bold text-ink">{shown(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
