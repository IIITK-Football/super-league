import { cn } from '../../utils/cn';

const VARIANTS = {
  primary: 'bg-acc text-accink font-black uppercase tracking-[0.16em] hover:brightness-110',
  secondary: 'glass text-ink hover:bg-ink/10',
  quiet: 'text-ink hover:bg-ink/10',
  danger: 'bg-live text-white font-black uppercase tracking-[0.16em] hover:brightness-110',
};
const SIZES = {
  sm: 'min-h-11 px-4 text-xs',
  md: 'min-h-11 px-5 text-sm',
  lg: 'min-h-12 px-6 text-sm',
};

// Classes for a button look, so a router link can wear the same style: <Link className={buttonClasses('primary')}>.
export function buttonClasses(variant = 'primary', size = 'md', className = '') {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-pill border border-transparent font-bold transition duration-200 ease-out',
    // Disabled reads as inert: a muted surface and text, never the accent fill.
    'disabled:pointer-events-none disabled:bg-raise disabled:text-mut disabled:border-line select-none',
    VARIANTS[variant] ?? VARIANTS.primary,
    SIZES[size] ?? SIZES.md,
    className,
  );
}
