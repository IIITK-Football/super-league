import { MotionConfig, motion } from 'motion/react';
import { cn } from '../../utils/cn';
import { SPRING } from './springs';

// An on/off switch. With `label` it renders its own text; otherwise name it with aria-label or a Field.
export function Switch({ checked = false, onChange, label, description, disabled, id, className, ...aria }) {
  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      {...aria}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill border p-0.5 transition-colors duration-200',
        // A 44px touch target around the 28px switch, without changing how it looks.
        "after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']",
        'outline-none focus-visible:ring-4 focus-visible:ring-ink/15 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'justify-end border-ink bg-ink' : 'justify-start border-ink/15 bg-ink/10',
        !label && className,
      )}
    >
      <motion.span layout transition={SPRING} aria-hidden="true" className={cn('size-5.5 rounded-pill shadow-sm', checked ? 'bg-bg' : 'bg-ink/70')} />
    </button>
  );
  if (!label) return <MotionConfig reducedMotion="user">{control}</MotionConfig>;
  return (
    <MotionConfig reducedMotion="user">
      <label className={cn('flex min-h-11 cursor-pointer items-center justify-between gap-4', disabled && 'cursor-not-allowed', className)}>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{label}</span>
          {description && <span className="block text-sm text-mut">{description}</span>}
        </span>
        {control}
      </label>
    </MotionConfig>
  );
}
