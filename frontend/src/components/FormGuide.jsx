import { cn } from '../utils/cn';

// The last results as small marks: W filled with the win colour, D outlined, L muted. Nothing played shows a dash.
const MARK = {
  W: 'bg-acc2 text-bg',
  D: 'border border-mut text-ink',
  L: 'bg-raise text-mut',
};

export function FormGuide({ form = [] }) {
  if (!form.length) return <span className="text-mut">–</span>;
  return (
    <ol aria-label={`Form: ${form.join(', ')}`} className="flex items-center gap-1">
      {form.map((result, i) => (
        <li
          key={`${result}-${i}`}
          className={cn('flex size-5 items-center justify-center rounded-full font-display text-xs font-bold', MARK[result] ?? MARK.L)}
        >
          {result}
        </li>
      ))}
    </ol>
  );
}
