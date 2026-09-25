import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { notify, Toaster } from './index';

describe('notify', () => {
  it('shows a success toast with the message the caller passed', async () => {
    render(<Toaster />);
    notify.success('Lesson published');

    await waitFor(() => expect(screen.getByText('Lesson published')).toBeInTheDocument());
  });

  it('escapes long messages instead of overflowing the viewport', async () => {
    render(<Toaster />);
    notify.error('A'.repeat(400));

    const toast = await screen.findByText('A'.repeat(400));
    expect(toast).toHaveClass('break-words');
  });

  it('turns the API error envelope into a human line, including field errors', async () => {
    render(<Toaster />);
    notify.fromApiError({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
      message: 'Check the highlighted fields.',
      details: { validation: { email: 'Already taken' } },
    });

    expect(await screen.findByText('Check the highlighted fields.')).toBeInTheDocument();
    expect(screen.getByText('email: Already taken')).toBeInTheDocument();
  });

  it('survives a garbage error object without showing [object Object]', async () => {
    render(<Toaster />);
    notify.fromApiError(undefined);

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('replaces its own loading toast when the async job settles', async () => {
    render(<Toaster />);
    const id = notify.loading('Uploading slide deck');
    await screen.findByText('Uploading slide deck');

    notify.success('Slide deck ready', { id });

    await waitFor(() => expect(screen.queryByText('Uploading slide deck')).not.toBeInTheDocument());
    expect(await screen.findByText('Slide deck ready')).toBeInTheDocument();
  });

  it('announces itself politely, not as an interruption', async () => {
    render(<Toaster />);
    notify.info('Payout scheduled');

    const card = (await screen.findByText('Payout scheduled')).closest('[role="status"]');
    expect(card).toHaveAttribute('aria-live', 'polite');
  });

  it('escalates a failure over a polite live region', async () => {
    render(<Toaster />);
    notify.error('Payout could not be scheduled');

    const card = (await screen.findByText('Payout could not be scheduled')).closest(
      '[role="alert"]',
    );
    expect(card).toHaveAttribute('aria-live', 'assertive');
  });
});

describe('action toasts', () => {
  it('can carry an action so an undo lives next to the message', async () => {
    render(<Toaster />);
    const onUndo = () => notify.success('Restored');

    notify.withAction({
      message: 'Booking cancelled',
      actionLabel: 'Undo',
      onAction: onUndo,
    });

    const button = await screen.findByRole('button', { name: 'Undo' });
    await userEvent.click(button);
    expect(await screen.findByText('Restored')).toBeInTheDocument();
  });
});
