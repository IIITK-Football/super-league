import { useState } from 'react';
import { PALETTES, currentPalette, setPalette } from '../../lib/theme';

// Dev-only control for comparing palettes on real pages: one small pill that cycles. Removed once the owner picks one.
export function PaletteSwitcher() {
  const [palette, setState] = useState(currentPalette);
  const next = PALETTES[(PALETTES.indexOf(palette) + 1) % PALETTES.length];
  return (
    <button
      type="button"
      onClick={() => {
        setPalette(next);
        setState(next);
      }}
      aria-label={`Palette ${palette}. Switch to ${next}`}
      className="fixed right-2 top-16 z-50 min-h-8 rounded-pill border border-line bg-surf/90 px-3 text-xs font-semibold capitalize text-mut hover:text-ink sm:top-20"
    >
      {palette}
    </button>
  );
}
