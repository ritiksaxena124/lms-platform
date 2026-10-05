'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  THEME_STORAGE_KEY,
  type ThemeMode,
  getStoredTheme,
  resolveTheme,
  setStoredTheme,
} from '@lms/shared';

/**
 * Manages the user's theme preference across light / dark / system.
 *
 * Reads the stored value on mount, writes it back on change, and keeps a
 * `data-theme` attribute on `<html>` so the CSS tokens can react. Listens to
 * system-preference changes when mode is `'system'`.
 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  // Initialise from storage (client-only).
  useEffect(() => {
    const stored = getStoredTheme();
    setMode(stored);
    setResolved(resolveTheme(stored));
  }, []);

  // Apply data-theme attribute whenever resolved theme changes.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  // Listen for system colour-scheme changes when in 'system' mode.
  useEffect(() => {
    if (mode !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setResolved(resolveTheme('system'));
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [mode]);

  const setTheme = useCallback((next: ThemeMode) => {
    setMode(next);
    setStoredTheme(next);
    setResolved(resolveTheme(next));
  }, []);

  const toggle = useCallback(() => {
    setTheme(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setTheme]);

  return { mode, resolved, setTheme, toggle };
}
