/** The three modes a user can choose for their interface appearance. */
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Storage key used by every portal — one preference shared across the product. */
export const THEME_STORAGE_KEY = 'hourloom.theme';

/** Read the stored preference, falling back to 'system'. */
export function getStoredTheme(): ThemeMode {
  if (typeof globalThis === 'undefined' || typeof (globalThis as any).window === 'undefined') return 'system';
  const stored = (globalThis as any).window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

/** Persist the choice so every tab sees it immediately. */
export function setStoredTheme(mode: ThemeMode): void {
  if (typeof globalThis === 'undefined' || typeof (globalThis as any).window === 'undefined') return;
  (globalThis as any).window.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

/** Resolve what the UI should actually render right now. */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof globalThis === 'undefined' || typeof (globalThis as any).window === 'undefined') return 'light';
    return (globalThis as any).window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}
