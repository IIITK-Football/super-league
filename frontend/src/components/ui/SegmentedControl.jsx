import { useId, useRef } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { cn } from '../../utils/cn';
import { SPRING } from './springs';

// Two to five choices on a glass track; a thumb slides to the chosen one. A radio group: arrows move and choose.
export function SegmentedControl({ options, value, onChange, disabled, className, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy, id }) {
  const thumbId = useId();
  const refs = useRef([]);
  const enabled = options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);

  const move = (index, step) => {
    const at = enabled.indexOf(index);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <MotionConfig reducedMotion="user">
      <div
        id={id}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-disabled={disabled || undefined}
        className={cn('well inline-flex w-full gap-1 rounded-ctl p-1', disabled && 'pointer-events-none opacity-50', className)}
      >
        {options.map((option, index) => {
          const checked = option.value === value;
          const focusable = checked || (value === undefined && index === enabled[0]);
          return (
            <button
              key={option.value}
              ref={(el) => { refs.current[index] = el; }}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled || option.disabled}
              tabIndex={focusable ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => {
                const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
                if (step) {
                  event.preventDefault();
                  move(index, step);
                }
              }}
              className={cn(
                'relative flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-[9px] px-3 text-sm font-bold transition-colors duration-200',
                'outline-none focus-visible:ring-2 focus-visible:ring-ink/40 disabled:opacity-40',
                checked ? 'text-bg' : 'text-mut hover:text-ink',
              )}
            >
              {checked && <motion.span layoutId={thumbId} transition={SPRING} aria-hidden="true" className="absolute inset-0 rounded-[9px] bg-ink shadow-[0_6px_18px_-8px_rgb(0_0_0/0.7)]" />}
              {option.icon && <span aria-hidden="true" className="relative flex">{option.icon}</span>}
              <span className="relative truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </MotionConfig>
  );
}
