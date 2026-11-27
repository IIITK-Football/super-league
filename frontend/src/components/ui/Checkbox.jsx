import { MotionConfig, motion } from 'motion/react';
import { cn } from '../../utils/cn';

// A native checkbox (forms and keyboard for free) drawn as a rounded glass box with an animated tick.
export function Checkbox({ checked = false, onChange, label, description, disabled, className, ...props }) {
  return (
    <MotionConfig reducedMotion="user">
      <label className={cn('group flex min-h-11 cursor-pointer items-center gap-3', disabled && 'cursor-not-allowed opacity-50', className)}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
          className="peer sr-only"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            'flex size-5.5 shrink-0 items-center justify-center rounded-[7px] border transition-colors duration-200',
            'peer-focus-visible:ring-4 peer-focus-visible:ring-ink/15',
            checked ? 'border-ink bg-ink text-bg' : 'border-ink/25 bg-ink/[0.04] group-hover:border-ink/45',
          )}
        >
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M3.5 8.5l3 3 6-7" initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} />
          </svg>
        </span>
        {(label || description) && (
          <span className="min-w-0">
            {label && <span className="block text-sm font-semibold text-ink">{label}</span>}
            {description && <span className="block text-sm text-mut">{description}</span>}
          </span>
        )}
      </label>
    </MotionConfig>
  );
}
