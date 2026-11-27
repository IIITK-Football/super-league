import { cn } from '../../utils/cn';

const TONES = {
  info: 'border-line text-ink',
  success: 'border-acc2/50 text-acc2',
  error: 'border-live/50 text-live',
  warning: 'border-acc/50 text-acc',
};

// Inline status next to a form or action. Announced politely to screen readers.
export function Notice({ tone = 'info', className, children, ...props }) {
  return (
    <div role="status" className={cn('rounded-ctl border bg-surf px-3 py-2 text-sm', TONES[tone] ?? TONES.info, className)} {...props}>
      {children}
    </div>
  );
}
