import { cn } from '../../utils/cn';

// A placeholder bar sized like the content it stands in for. Pass a Tailwind size class, e.g. "h-4 w-32".
export function Skeleton({ className, ...props }) {
  return <div aria-hidden="true" className={cn('rounded-ctl bg-raise motion-safe:animate-pulse', className)} {...props} />;
}
