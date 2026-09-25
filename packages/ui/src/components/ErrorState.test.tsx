import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('announces the failure to assistive tech and explains what to do', () => {
    render(
      <ErrorState
        title="Could not load your bookings"
        message="The request timed out. Your bookings are safe — try again."
      />,
    );

    const alert = screen.getByRole('alert');
    expect(screen.getByText('Could not load your bookings')).toBeInTheDocument();
    expect(alert).toHaveTextContent('The request timed out. Your bookings are safe');
  });

  it('offers a retry that the caller can drive', async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Network dropped" onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('lets the caller rename and busy the retry during a refetch', async () => {
    render(<ErrorState title="Saved offline" onRetry={() => {}} retryLabel="Reload page" busy />);

    const button = screen.getByRole('button', { name: /Reload page/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('shows no retry button when a retry would not help', () => {
    render(<ErrorState title="This course is no longer listed" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
