/** The three modes a user can choose for their interface appearance. */
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Storage key used by every portal — one preference shared across the product. */
export const THEME_STORAGE_KEY = 'hourloom.theme';

/** Read the stored preference, falling back to 'system'. */
export function getStoredTheme(): ThemeMode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = (globalThis as any)?.window;
  if (!win) return 'system';
  const stored = win.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

/** Persist the choice so every tab sees it immediately. */
export function setStoredTheme(mode: ThemeMode): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = (globalThis as any)?.window;
  if (!win) return;
  win.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

/** Resolve what the UI should actually render right now. */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = (globalThis as any)?.window;
    if (!win) return 'light';
    return win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}
