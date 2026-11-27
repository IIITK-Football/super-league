import { cn } from '../../utils/cn';

const TONES = {
  neutral: 'bg-raise text-mut',
  acc: 'bg-acc text-accink',
  win: 'bg-acc2/15 text-acc2',
  live: 'bg-live/15 text-live',
};

// tone="live" shows a pulsing dot (motion stops under reduced motion).
export function Pill({ tone = 'neutral', className, children, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-semibold tracking-wide',
        TONES[tone] ?? TONES.neutral,
        className,
      )}
      {...props}
    >
      {tone === 'live' && <span aria-hidden="true" className="size-1.5 rounded-full bg-live motion-safe:animate-pulse-dot" />}
      {children}
    </span>
  );
}
