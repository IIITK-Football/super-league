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
    'inline-flex items-center justify-center gap-2 rounded-ctl font-semibold transition duration-200 ease-out',
    'disabled:opacity-50 disabled:pointer-events-none select-none',
    VARIANTS[variant] ?? VARIANTS.primary,
    SIZES[size] ?? SIZES.md,
    className,
  );
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}
