import { useId } from 'react';
import { cn } from '../../utils/cn';

const CONTROL = 'min-h-11 w-full rounded-ctl border bg-surf px-3 py-2 text-ink placeholder:text-mut focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc disabled:opacity-50';

// A labelled control. as="select" takes <option> children; as="textarea" takes rows. Error text is linked to the control.
export function Field({ label, error, hint, as: Control = 'input', id, className, children, ...props }) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={fieldId} className="text-sm font-semibold text-ink">{label}</label>
      <Control
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(CONTROL, error ? 'border-live' : 'border-line')}
        {...props}
      >
        {children}
      </Control>
      {hint && <p id={hintId} className="text-sm text-mut">{hint}</p>}
      {error && <p id={errorId} className="text-sm text-live">{error}</p>}
    </div>
  );
}
