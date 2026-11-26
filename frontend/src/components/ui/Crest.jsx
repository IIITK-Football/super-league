import { useState } from 'react';
import { cn } from '../../utils/cn';

const SIZES = { sm: 'size-8', md: 'size-11', lg: 'size-16' };
// Three initials need a smaller face so they fit the circle.
const TEXT = { sm: ['text-xs', 'text-[0.6rem]'], md: ['text-sm', 'text-xs'], lg: ['text-xl', 'text-base'] };

// initials("Super League") -> "SL"; up to three words. Used when there is no logo or it fails to load.
function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 3).map((word) => word[0].toUpperCase()).join('');
}

// A team or division logo, contained on a neutral surface so no part of it is cropped. Without a usable image it
// shows 1 to 3 initials on the given colour (never a made-up crest).
export function Crest({ name, src, color, size = 'md', className }) {
  const [failed, setFailed] = useState(false);
  const sizing = SIZES[size] ?? SIZES.md;
  const box = cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-bold', sizing, className);

  if (src && !failed) {
    return (
      <span className={cn(box, 'bg-raise p-1.5')}>
        <img src={src} alt={name ? `${name} crest` : ''} className="size-full object-contain" onError={() => setFailed(true)} />
      </span>
    );
  }
  const code = initials(name) || '?';
  const [text, small] = TEXT[size] ?? TEXT.md;
  return (
    <span
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : 'true'}
      className={cn(box, 'px-0.5 leading-none text-accink', code.length > 2 ? cn(small, 'tracking-tight') : text)}
      style={{ backgroundColor: color || 'var(--div)' }}
    >
      {code}
    </span>
  );
}
