import { cn } from '../../utils/cn';

const VARIANTS = {
  primary: 'bg-acc text-accink hover:brightness-110',
  secondary: 'bg-raise text-ink border border-line hover:border-mut',
  quiet: 'text-ink hover:bg-raise',
  danger: 'bg-live text-white hover:brightness-110',
};
const SIZES = {
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-11 px-4 text-base',
  lg: 'min-h-12 px-5 text-lg',
};

// Classes for a button look, so a router link can wear the same style: <Link className={buttonClasses('primary')}>.
export function buttonClasses(variant = 'primary', size = 'md', className = '') {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-ctl border border-transparent font-semibold transition duration-200 ease-out',
    // Disabled reads as inert: a muted surface and text, never the accent fill.
    'disabled:pointer-events-none disabled:bg-raise disabled:text-mut disabled:border-line select-none',
    VARIANTS[variant] ?? VARIANTS.primary,
    SIZES[size] ?? SIZES.md,
    className,
  );
}
