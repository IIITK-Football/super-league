import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { currentTheme, setTheme } from '../../lib/theme';

// Switches between light and dark and remembers the choice on this device.
export function ThemeToggle() {
  const [theme, setThemeState] = useState(currentTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Sun : Moon;

  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next);
        setThemeState(next);
      }}
      className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-raise"
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
