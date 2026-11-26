import { useState } from 'react';
import { cn } from '../../utils/cn';

const SIZES = { sm: 'size-8 text-xs', md: 'size-11 text-sm', lg: 'size-16 text-xl' };

// initials("Super League") -> "SL". Used when there is no logo or it fails to load.
function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('');
}

// A team or division logo. Without a usable image it shows initials on the given colour (never a made-up crest).
export function Crest({ name, src, color, size = 'md', className }) {
  const [failed, setFailed] = useState(false);
  const box = cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-bold', SIZES[size] ?? SIZES.md, className);

  if (src && !failed) {
    return (
      <span className={cn(box, 'bg-raise')}>
        <img src={src} alt={name ? `${name} crest` : ''} className="size-full object-contain" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : 'true'}
      className={cn(box, 'text-accink')}
      style={{ backgroundColor: color || 'var(--div)' }}
    >
      {initials(name) || '?'}
    </span>
  );
}
