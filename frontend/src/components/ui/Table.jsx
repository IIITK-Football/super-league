import { cn } from '../../utils/cn';

// A data table that scrolls sideways on phones. The first column stays put while the rest scroll, and a fade on
// the right edge shows there is more. Use plain <thead>, <tr>, <th>, <td> children.
export function Table({ caption, className, children }) {
  return (
    <div className={cn('relative w-full overflow-x-auto rounded-card border border-line bg-surf', className)}>
      <table className="w-full border-collapse text-sm tabular-nums [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-mut [&_td]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-ink [&_tr]:border-b [&_tr]:border-line [&_tr:last-child]:border-0 [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-[1] [&_th:first-child]:bg-surf [&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-[1] [&_td:first-child]:bg-surf">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surf to-transparent md:hidden" />
    </div>
  );
}
