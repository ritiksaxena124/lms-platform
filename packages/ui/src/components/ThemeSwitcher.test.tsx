import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThemeSwitcher } from './ThemeSwitcher';

// Mock the useTheme hook to control its return value.
vi.mock('../hooks/use-theme', () => ({
  useTheme: vi.fn(),
}));

const { useTheme } = await import('../hooks/use-theme');

describe('ThemeSwitcher', () => {
  it('renders three buttons for light, dark and auto', () => {
    vi.mocked(useTheme).mockReturnValue({
      mode: 'light',
      resolved: 'light',
      setTheme: vi.fn(),
      toggle: vi.fn(),
    });

    render(<ThemeSwitcher />);

    expect(screen.getByRole('radio', { name: 'Light' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeVisible();
  });

  it('marks the active mode as checked', () => {
    vi.mocked(useTheme).mockReturnValue({
      mode: 'dark',
      resolved: 'dark',
      setTheme: vi.fn(),
      toggle: vi.fn(),
    });

    render(<ThemeSwitcher />);

    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('calls setTheme when a different mode is clicked', async () => {
    const setTheme = vi.fn();
    vi.mocked(useTheme).mockReturnValue({
      mode: 'light',
      resolved: 'light',
      setTheme,
      toggle: vi.fn(),
    });

    render(<ThemeSwitcher />);
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(setTheme).toHaveBeenCalledWith('dark');
  });
});
