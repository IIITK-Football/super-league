import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { usePopover } from './usePopover';

// Shows the division in view with its accent dot and crest. The list links to each division's home.
export function DivisionSwitcher({ divisions, loading, division, current }) {
  const [open, setOpen] = useState(false);
  const ref = usePopover(open, () => setOpen(false));
  const accent = current?.primary_color;

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 max-w-[11rem] items-center gap-2 rounded-ctl px-2 text-left text-ink hover:bg-raise sm:max-w-xs"
      >
        {loading ? <Skeleton className="h-4 w-24" /> : (
          <>
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-acc" style={accent ? { backgroundColor: accent } : undefined} />
            <span className="truncate font-display text-lg font-bold leading-none">{current?.name ?? division}</span>
          </>
        )}
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-mut" />
      </button>
      {open && (
        <ul role="list" className="absolute left-0 top-full z-50 mt-2 min-w-[14rem] rounded-card border border-line bg-surf p-1.5 shadow-none">
          {divisions.map((item) => (
            <li key={item.slug}>
              <Link
                to={`/${item.slug}`}
                aria-current={item.slug === division ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center gap-3 rounded-ctl px-3 text-ink hover:bg-raise"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full bg-acc"
                  style={item.primary_color ? { backgroundColor: item.primary_color } : undefined}
                />
                <span className={item.slug === division ? 'font-semibold' : ''}>{item.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
