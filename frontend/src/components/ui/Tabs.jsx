import { useRef } from 'react';
import { cn } from '../../utils/cn';

// Segmented tabs. Left and Right move between tabs, as the WAI-ARIA pattern expects. The caller renders the panel.
export function Tabs({ tabs, value, onChange, label, className }) {
  const refs = useRef([]);

  const move = (index, step) => {
    const next = (index + step + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}>
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
            style={selected ? { borderColor: 'var(--div)' } : undefined}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') move(index, 1);
              if (event.key === 'ArrowLeft') move(index, -1);
            }}
            className={cn(
              'min-h-11 shrink-0 border-b-2 px-4 text-sm font-semibold transition-colors',
              selected ? 'text-ink' : 'border-transparent text-mut hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
