'use client';

import { cn } from '../lib/cn';
import { useTheme } from '../hooks/use-theme';

const MODES = [
  { value: 'light' as const, label: 'Light', icon: SunIcon },
  { value: 'dark' as const, label: 'Dark', icon: MoonIcon },
  { value: 'system' as const, label: 'Auto', icon: SystemIcon },
] as const;

/**
 * A compact three-way switch for light / dark / system.
 *
 * Renders as a segmented control on desktop and a dropdown-friendly row on
 * mobile. Uses the shared `useTheme` hook so the choice persists across tabs
 * and sessions.
 */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { mode, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('flex items-center gap-1 rounded-field bg-paper-sunk p-0.5', className)}
    >
      {MODES.map(({ value, label, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              'relative flex items-center justify-center rounded-field px-2 py-1.5 text-[0.75rem] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
              active
                ? 'bg-surface font-semibold text-ink'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <Icon />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <path d="M8 21h8m-4-4v4" />
    </svg>
  );
}
