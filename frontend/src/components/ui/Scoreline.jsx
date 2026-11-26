import { cn } from '../../utils/cn';

// A score in display numerals. A missing score shows a dash, never 0. A changed score ticks over once (motion off
// under reduced motion): the value is the React key, so the element is recreated on every change.
function Score({ value, live }) {
  const shown = value === null || value === undefined || value === '' ? '-' : value;
  return (
    <span className={cn('inline-block min-w-[1ch] text-center', live && shown !== '-' && 'motion-safe:animate-tick')}>
      {shown}
    </span>
  );
}

// home and away are numbers, or null when not known. live animates changes as a goal moment.
export function Scoreline({ home, away, live = false, size = 'md', className }) {
  const sizing = size === 'lg' ? 'text-6xl sm:text-8xl' : size === 'sm' ? 'text-xl' : 'text-3xl sm:text-4xl';
  return (
    <span className={cn('inline-flex items-center gap-2 font-display font-extrabold leading-none tabular-nums text-ink', sizing, className)}>
      <Score key={`home-${home}`} value={home} live={live} />
      <span aria-hidden="true" className="text-current opacity-50">-</span>
      <Score key={`away-${away}`} value={away} live={live} />
    </span>
  );
}
