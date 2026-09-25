import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buttonClass } from '../lib/button';
import { Button } from './Button';

describe('Button', () => {
  it('renders as an enabled submit button by default', () => {
    render(<Button>Save lesson</Button>);
    const button = screen.getByRole('button', { name: 'Save lesson' });
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(button).toHaveAttribute('data-size', 'md');
  });

  it('exposes variant and size to styling without leaking them as DOM attributes', () => {
    render(
      <Button variant="danger" size="sm">
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveAttribute('data-variant', 'danger');
    expect(button).toHaveAttribute('data-size', 'sm');
    expect(button).not.toHaveAttribute('variant');
  });

  it('blocks the action and announces busy state while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Publishing
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Publishing/ });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    // The label stays visible during the wait so the action remains readable.
    expect(button).toHaveTextContent('Publishing');
    expect(button.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('supports a leading icon and a full-width layout', () => {
    render(
      <Button leadingIcon={<svg data-testid="icon" />} fullWidth>
        Continue
      </Button>,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveClass('w-full');
  });

  it('merges caller classes last so a page can tune spacing', () => {
    render(<Button className="mt-6 px-8">Merge conflict check</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('mt-6');
    expect(button.className.match(/px-8/g)).toHaveLength(1);
  });

  it('honours a plain disabled state without inventing a spinner', () => {
    render(<Button disabled>Send invite</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button.querySelector('[role="status"]')).toBeNull();
  });
});

describe('buttonClass', () => {
  it('gives a link the same shape as a button so actions stay consistent', () => {
    const className = buttonClass({ variant: 'secondary', size: 'sm', fullWidth: true });
    expect(className).toContain('w-full');
    expect(className).toContain('rounded');
  });

  /** Next turns `'use client'` into a runtime wall, not a compile error: a server page that
   * reaches through it fails when the route is opened in a browser. The module file is the
   * only place that boundary is written down, so it is the file this checks. */
  it('lives outside the client boundary, where a server page can call it', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'button.ts'),
      'utf8',
    );
    expect(source.trimStart().startsWith("'use client'")).toBe(false);
  });
});
