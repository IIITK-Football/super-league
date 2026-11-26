// Light or dark. With no saved choice the device decides (index.html applies a saved choice before first paint).
const KEY = 'sl-theme';

export function currentTheme() {
  const saved = document.documentElement.dataset.theme;
  if (saved === 'light' || saved === 'dark') return saved;
  return 'dark';
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be blocked (private windows); the choice then lasts for this visit only.
  }
}

