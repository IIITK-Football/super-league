import { useId } from 'react';
import { cn } from '../../utils/cn';
import { CONTROL } from './controlClasses';

// A labelled control. as="select" takes <option> children; as="textarea" takes rows. Error text is linked to the control.
// For a custom control pass a function child: it receives { id, 'aria-labelledby', 'aria-describedby', 'aria-invalid' }.
export function Field({ label, error, hint, as: Control = 'input', id, className, children, ...props }) {
  const generated = useId();
  const fieldId = id ?? generated;
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  const linked = { id: fieldId, 'aria-labelledby': labelId, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label id={labelId} htmlFor={fieldId} className="eyebrow">{label}</label>
      {typeof children === 'function' ? children(linked) : (
        <Control
          id={fieldId}
          aria-invalid={linked['aria-invalid']}
          aria-describedby={describedBy}
          className={cn(CONTROL, Control === 'textarea' && 'py-3')}
          {...props}
        >
          {children}
        </Control>
      )}
      {hint && <p id={hintId} className="text-sm text-mut">{hint}</p>}
      {error && <p id={errorId} className="text-sm font-semibold text-live">{error}</p>}
    </div>
  );
}
