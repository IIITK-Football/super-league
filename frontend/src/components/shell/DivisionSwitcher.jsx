import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { Skeleton } from '../ui/Skeleton';

// The divisions as one glass segmented control; the one in view is lit. compact is the header size. Names come from
// data, never the slug.
export function DivisionSwitcher({ divisions, loading, division, current, compact = false, onPick }) {
  if (loading) {
    return <span aria-busy="true" className="inline-flex"><Skeleton className={compact ? 'h-10 w-64 rounded-pill' : 'h-12 w-full max-w-md rounded-pill'} /></span>;
  }
  if (divisions.length === 0) return <span className="truncate font-semibold text-ink">{current?.name ?? 'Division'}</span>;

  return (
    <nav aria-label="Divisions" className={cn('glass inline-flex max-w-full gap-1 overflow-x-auto rounded-pill p-1 no-scrollbar', !compact && 'w-full sm:w-auto')}>
      {divisions.map((item) => {
        const active = item.slug === division;
        return (
          <Link
            key={item.slug}
            to={`/${item.slug}`}
            onClick={onPick}
            aria-current={active ? 'page' : undefined}
            className={cn('flex shrink-0 items-center justify-center whitespace-nowrap rounded-pill font-bold uppercase tracking-wider transition-colors duration-300',
              compact ? 'min-h-9 px-4 text-xs' : 'min-h-11 flex-1 px-5 text-sm',
              active ? 'bg-ink text-bg' : 'text-mut hover:text-ink')}
          >
            <span className={active ? 'truncate' : 'truncate'}>{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
