import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('describes the empty condition and offers the way out', () => {
    render(
      <EmptyState
        title="No lessons yet"
        description="Lessons you publish from a course will show up here."
        actionLabel="Create a lesson"
        onAction={() => {}}
      />,
    );

    expect(screen.getByText('No lessons yet')).toBeInTheDocument();
    expect(
      screen.getByText('Lessons you publish from a course will show up here.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a lesson' })).toBeInTheDocument();
  });

  it('renders no affordance when the viewer cannot act on the emptiness', () => {
    render(<EmptyState title="Nothing scheduled this week" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('routes the action callback to the caller', async () => {
    const onAction = vi.fn();
    render(<EmptyState title="No bookings" actionLabel="Share your link" onAction={onAction} />);

    await userEvent.click(screen.getByRole('button', { name: 'Share your link' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('marks itself as a status region so a late-arriving empty list is announced', () => {
    render(<EmptyState title="No results for “physics”" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
