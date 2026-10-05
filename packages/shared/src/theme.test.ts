import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, getStoredTheme, resolveTheme, setStoredTheme } from './theme';

// Mock localStorage and matchMedia for Node environment
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    clear: () => { store = {}; },
  };
})();

let mockDarkPreference = false;

beforeEach(() => {
  mockLocalStorage.clear();
  mockDarkPreference = false;
  
  // Set up global mocks
  (globalThis as any).window = {
    localStorage: mockLocalStorage,
    matchMedia: (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? mockDarkPreference : !mockDarkPreference,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  };
});

afterEach(() => {
  delete (globalThis as any).window;
});

describe('theme preferences', () => {
  it('defaults to system when nothing is stored', () => {
    expect(getStoredTheme()).toBe('system');
  });

  it('round-trips a valid mode through storage', () => {
    setStoredTheme('dark');
    expect(getStoredTheme()).toBe('dark');
    setStoredTheme('light');
    expect(getStoredTheme()).toBe('light');
    setStoredTheme('system');
    expect(getStoredTheme()).toBe('system');
  });

  it('falls back to system for garbage in storage', () => {
    mockLocalStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(getStoredTheme()).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('returns the explicit mode when light or dark', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('honours a dark system preference', () => {
    mockDarkPreference = true;
    expect(resolveTheme('system')).toBe('dark');
  });

  it('honours a light system preference', () => {
    mockDarkPreference = false;
    expect(resolveTheme('system')).toBe('light');
  });
});
