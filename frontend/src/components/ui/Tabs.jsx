import { useId, useRef } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { cn } from '../../utils/cn';
import { SPRING } from './springs';

// Segmented tabs. Left and Right move between tabs, as the WAI-ARIA pattern expects. The caller renders the panel.
// The underline slides to the selected tab.
export function Tabs({ tabs, value, onChange, label, className }) {
  const refs = useRef([]);
  const indicatorId = useId();

  const move = (index, step) => {
    const next = (index + step + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <MotionConfig reducedMotion="user">
      <div role="tablist" aria-label={label} className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-line', className)}>
        {tabs.map((tab, index) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(el) => { refs.current[index] = el; }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') move(index, 1);
                if (event.key === 'ArrowLeft') move(index, -1);
              }}
              className={cn(
                'relative min-h-11 shrink-0 rounded-t-ctl px-4 text-sm font-bold transition-colors duration-200',
                'outline-none focus-visible:bg-ink/[0.06]',
                selected ? 'text-ink' : 'text-mut hover:text-ink',
              )}
            >
              {tab.label}
              {selected && (
                <motion.span
                  layoutId={indicatorId}
                  transition={SPRING}
                  aria-hidden="true"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-pill"
                  style={{ background: 'var(--div)' }}
                />
              )}
            </button>
          );
        })}
      </div>
    </MotionConfig>
  );
}
