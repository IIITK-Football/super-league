import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../../utils/cn';

const clampTo = (n, min, max) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

// A stepper for counts and minutes: - and + (hold to repeat), Up and Down step, Page keys step by ten,
// Home and End jump to min and max. Typed values are clamped when committed (Enter or leaving the field).
export function NumberField({
  value, onChange, min, max, step = 1, size = 'md', disabled, id, name, className, placeholder,
  'aria-label': ariaLabel, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy, 'aria-invalid': invalid,
}) {
  const [draft, setDraft] = useState(null);
  const current = useRef(value);
  current.current = value;
  const change = useRef(onChange);
  change.current = onChange;
  const timers = useRef({});
  const fromPointer = useRef(false);

  const set = (n) => {
    const next = clampTo(n, min, max);
    if (next === current.current) return false;
    current.current = next;
    change.current?.(next);
    return true;
  };
  const bump = (delta) => set((current.current ?? min ?? 0) + delta);

  const stop = () => {
    clearTimeout(timers.current.wait);
    clearInterval(timers.current.repeat);
  };
  useEffect(() => stop, []);

  const press = (delta) => (event) => {
    if (event.button !== 0 || disabled) return;
    fromPointer.current = true;
    bump(delta);
    timers.current.wait = setTimeout(() => { timers.current.repeat = setInterval(() => { if (!bump(delta)) stop(); }, 70); }, 420);
  };
  // A click without a pointer press (screen readers, switch access) steps once.
  const click = (delta) => () => {
    if (fromPointer.current) fromPointer.current = false;
    else bump(delta);
  };

  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (draft.trim() !== '' && Number.isFinite(parsed)) set(parsed);
  };

  const onKeyDown = (event) => {
    const actions = {
      ArrowUp: () => bump(step), ArrowDown: () => bump(-step),
      PageUp: () => bump(step * 10), PageDown: () => bump(-step * 10),
      Home: () => min !== undefined && set(min), End: () => max !== undefined && set(max),
      Enter: commit,
    };
    if (!actions[event.key]) return;
    event.preventDefault();
    if (event.key !== 'Enter') setDraft(null);
    actions[event.key]();
  };

  const big = size === 'lg';
  const atMin = min !== undefined && value !== null && value !== undefined && value <= min;
  const atMax = max !== undefined && value !== null && value !== undefined && value >= max;
  const stepper = (delta, Icon, label, off) => (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      disabled={disabled || off}
      onPointerDown={press(delta)}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={click(delta)}
      className={cn(
        'flex shrink-0 touch-manipulation select-none items-center justify-center rounded-[9px] text-ink transition duration-150',
        'hover:bg-ink/10 active:scale-95 active:bg-ink/15 disabled:opacity-30 motion-reduce:active:scale-100',
        big ? 'size-14' : 'size-9',
      )}
    >
      <Icon size={big ? 22 : 16} aria-hidden="true" />
    </button>
  );

  return (
    <div className={cn('well flex w-full items-center gap-1 rounded-ctl p-1', big ? 'min-h-16' : 'min-h-11', className)}>
      {stepper(-step, Minus, 'Decrease', atMin)}
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        role="spinbutton"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-valuenow={value ?? undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        value={draft ?? (value ?? '')}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full min-w-0 bg-transparent text-center font-display tabular-nums text-ink outline-none placeholder:text-mut',
          big ? 'text-4xl' : 'text-lg',
        )}
      />
      {stepper(step, Plus, 'Increase', atMax)}
    </div>
  );
}
