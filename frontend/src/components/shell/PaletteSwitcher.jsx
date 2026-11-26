import { useState } from 'react';
import { PALETTES, currentPalette, setPalette } from '../../lib/theme';

// Dev-only control for comparing palettes on real pages. Removed once the owner picks one.
export function PaletteSwitcher() {
  const [palette, setState] = useState(currentPalette);
  return (
    <div className="fixed bottom-24 right-4 z-50 flex gap-1 rounded-pill border border-line bg-surf p-1 shadow-lg md:bottom-4" role="group" aria-label="Palette preview">
      {PALETTES.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={palette === p}
          onClick={() => {
            setPalette(p);
            setState(p);
          }}
          className={`min-h-9 rounded-pill px-3 text-xs font-semibold capitalize ${palette === p ? 'bg-acc text-accink' : 'text-mut hover:text-ink'}`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
