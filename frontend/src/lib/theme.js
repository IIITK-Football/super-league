// Light or dark. With no saved choice the device decides (index.html applies a saved choice before first paint).
const KEY = 'sl-theme';

export function currentTheme() {
  const saved = document.documentElement.dataset.theme;
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be blocked (private windows); the choice then lasts for this visit only.
  }
}

// Palette preview (dev only for now): cobalt, pitch or signal, stored like the theme.
const PALETTE_KEY = 'sl-palette';
export const PALETTES = ['cobalt', 'pitch', 'signal'];

export function currentPalette() {
  const p = document.documentElement.dataset.palette;
  return PALETTES.includes(p) ? p : 'cobalt';
}

export function setPalette(palette) {
  document.documentElement.dataset.palette = palette;
  try {
    localStorage.setItem(PALETTE_KEY, palette);
  } catch {
    // Storage can be blocked; the choice then lasts for this visit only.
  }
}
