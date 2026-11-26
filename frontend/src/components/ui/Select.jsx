import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../utils/cn';
import { SPRING } from './springs';

const matching = (options, query) => {
  const q = query.trim().toLowerCase();
  return q ? options.filter((option) => `${option.label} ${option.description ?? ''}`.toLowerCase().includes(q)) : options;
};

const nextEnabled = (options, from, step) => {
  for (let i = 1; i <= options.length; i += 1) {
    const index = (from + step * i + options.length * i) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
};

// A custom listbox on a Radix popover. Mirrors a native select: value, onChange(value), options, placeholder, name.
// Keys: arrows, Home, End, Enter or Space to pick, Escape to close, typing jumps to a matching label.
// `searchable` adds a filter box (that is the Combobox).
export function Select({
  value, onChange, options = [], placeholder = 'Choose', name, disabled, id, className,
  searchable = false, searchPlaceholder = 'Search', emptyText = 'No matches',
  'aria-labelledby': labelledBy, 'aria-label': ariaLabel, 'aria-describedby': describedBy, 'aria-invalid': invalid,
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const valueId = `${uid}-value`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const typed = useRef({ text: '', at: 0 });

  const selected = options.find((option) => option.value === value);
  const shown = useMemo(() => matching(options, query), [options, query]);

  const openList = (state) => {
    setOpen(state);
    if (state) {
      setQuery('');
      const current = options.findIndex((option) => option.value === value);
      setActive(current >= 0 ? current : nextEnabled(options, -1, 1));
    }
  };

  const pick = (option) => {
    if (!option || option.disabled) return;
    onChange?.(option.value);
    setOpen(false);
  };

  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, uid]);

  const onListKey = (event) => {
    const last = shown.length - 1;
    const moves = { ArrowDown: () => nextEnabled(shown, active, 1), ArrowUp: () => nextEnabled(shown, active < 0 ? 0 : active, -1), Home: () => nextEnabled(shown, -1, 1), End: () => nextEnabled(shown, last + 1, -1) };
    if (moves[event.key] && shown.length) {
      event.preventDefault();
      setActive(moves[event.key]());
    } else if (event.key === 'Enter' || (event.key === ' ' && !searchable)) {
      event.preventDefault();
      pick(shown[active]);
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (!searchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : '') + event.key.toLowerCase(), at: now };
      const text = typed.current.text;
      // A repeated single letter cycles through the labels that start with it, as a native select does.
      const start = text.length === 1 ? active + 1 : active;
      for (let i = 0; i < shown.length; i += 1) {
        const index = (start + i) % shown.length;
        if (!shown[index].disabled && shown[index].label.toLowerCase().startsWith(text)) {
          setActive(index);
          break;
        }
      }
    }
  };

  const activeId = active >= 0 && shown[active] ? `${uid}-opt-${active}` : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <PopoverPrimitive.Root open={open} onOpenChange={openList}>
        <PopoverPrimitive.Trigger
          id={id}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={ariaLabel}
          aria-labelledby={labelledBy ? `${labelledBy} ${valueId}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              openList(true);
            }
          }}
          className={cn(
            'well group flex min-h-11 w-full items-center gap-2.5 rounded-ctl px-3.5 text-left text-base text-ink sm:text-sm',
            'disabled:cursor-not-allowed',
            className,
          )}
        >
          {selected?.icon && <span aria-hidden="true" className="flex shrink-0 items-center">{selected.icon}</span>}
          <span id={valueId} className={cn('min-w-0 flex-1 truncate', selected ? 'font-semibold' : 'text-mut')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-mut transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </PopoverPrimitive.Trigger>
        {name && <input type="hidden" name={name} value={value ?? ''} />}

        <AnimatePresence>
          {open && (
            <PopoverPrimitive.Portal forceMount>
              <PopoverPrimitive.Content
                forceMount
                asChild
                align="start"
                sideOffset={8}
                collisionPadding={12}
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  (searchable ? searchRef : listRef).current?.focus();
                }}
              >
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
                  transition={SPRING}
                  style={{ minWidth: 'var(--radix-popover-trigger-width)', transformOrigin: 'var(--radix-popover-content-transform-origin)' }}
                  className="float-glass z-50 flex max-h-[min(22rem,var(--radix-popover-content-available-height))] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-ctl"
                >
                  {searchable && (
                    <div className="flex items-center gap-2 border-b border-line px-3.5">
                      <Search size={16} aria-hidden="true" className="shrink-0 text-mut" />
                      <input
                        ref={searchRef}
                        role="combobox"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-autocomplete="list"
                        aria-activedescendant={activeId}
                        aria-label={searchPlaceholder}
                        placeholder={searchPlaceholder}
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setActive(nextEnabled(matching(options, event.target.value), -1, 1));
                        }}
                        onKeyDown={onListKey}
                        className="min-h-11 w-full bg-transparent text-base text-ink outline-none placeholder:text-mut sm:text-sm"
                      />
                    </div>
                  )}
                  <ul
                    ref={listRef}
                    id={listId}
                    role="listbox"
                    tabIndex={searchable ? undefined : -1}
                    aria-labelledby={labelledBy}
                    aria-label={labelledBy ? undefined : ariaLabel}
                    aria-activedescendant={searchable ? undefined : activeId}
                    onKeyDown={searchable ? undefined : onListKey}
                    className="overflow-y-auto overscroll-contain p-1.5 outline-none"
                  >
                    {shown.map((option, index) => {
                      const isSelected = option.value === value;
                      return (
                        <li
                          key={option.value}
                          id={`${uid}-opt-${index}`}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={option.disabled || undefined}
                          onPointerMove={() => !option.disabled && setActive(index)}
                          onClick={() => pick(option)}
                          className={cn(
                            'relative flex min-h-11 cursor-default select-none items-center gap-3 rounded-[9px] px-2.5 py-2 text-sm text-ink',
                            index === active && 'bg-ink/[0.08]',
                            option.disabled && 'opacity-40',
                          )}
                        >
                          {option.icon && <span aria-hidden="true" className="flex shrink-0 items-center">{option.icon}</span>}
                          <span className="min-w-0 flex-1">
                            <span className={cn('block truncate', isSelected ? 'font-bold' : 'font-medium')}>{option.label}</span>
                            {option.description && <span className="block truncate text-xs text-mut">{option.description}</span>}
                          </span>
                          {isSelected && <Check size={16} aria-hidden="true" className="shrink-0 text-ink" />}
                        </li>
                      );
                    })}
                    {shown.length === 0 && <li role="presentation" className="px-3 py-6 text-center text-sm text-mut">{emptyText}</li>}
                  </ul>
                </motion.div>
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          )}
        </AnimatePresence>
      </PopoverPrimitive.Root>
    </MotionConfig>
  );
}

// A Select with a search box that filters the list (long lists of players or teams).
export function Combobox(props) {
  return <Select searchable placeholder="Search or choose" {...props} />;
}
