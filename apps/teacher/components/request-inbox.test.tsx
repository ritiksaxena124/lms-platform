import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingRequest } from '@lms/shared';

import { ApiError } from '@/lib/api';

import { RequestInbox } from './request-inbox';

const api = vi.hoisted(() => ({
  listRequests: vi.fn(),
  confirmRequest: vi.fn(),
  refuseRequest: vi.fn(),
}));

vi.mock('@/lib/bookings', () => api);
vi.mock('./session-provider', () => ({
  useSession: () => ({ status: 'signed-in', user: { timezone: 'Asia/Kolkata' } }),
}));

function request(overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    id: 'b1',
    course: { id: 'c1', slug: 'veena-basics', title: 'Veena Basics' },
    type: 'enrolled',
    status: 'pending',
    live: null,
    startsAt: '2026-10-01T03:30:00.000Z',
    endsAt: '2026-10-01T04:15:00.000Z',
    durationMinutes: 45,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
    student: { id: 's1', displayName: 'Rohan Mehta' },
    ...overrides,
  };
}

const QUEUE = [
  request(),
  request({ id: 'b2', student: { id: 's2', displayName: 'Ishaan Kulkarni' } }),
];

beforeEach(() => {
  api.listRequests.mockReset().mockResolvedValue(QUEUE);
  api.confirmRequest.mockReset().mockResolvedValue({ ...QUEUE[0]!, status: 'confirmed' });
  api.refuseRequest.mockReset().mockResolvedValue({ ...QUEUE[0]!, status: 'rejected' });
});

describe('RequestInbox', () => {
  it('shows who is asking, what they asked for, and when the class would run', async () => {
    render(<RequestInbox />);

    expect(await screen.findByText('Rohan Mehta')).toBeInTheDocument();
    expect(screen.getByText('Ishaan Kulkarni')).toBeInTheDocument();
    expect(screen.getAllByText('Veena Basics')).toHaveLength(2);
    // The teacher's own clock, in the same twenty-four hour dialect as their windows.
    expect(screen.getAllByText('Thu 1 Oct, 09:00–09:45')).toHaveLength(2);
  });

  it('says whose clock the queue is written on', async () => {
    render(<RequestInbox />);

    expect(await screen.findByText(/Asia\/Kolkata/)).toBeInTheDocument();
  });

  it('names a trial call, because it is a different decision than a class', async () => {
    api.listRequests.mockResolvedValue([request({ type: 'demo' })]);
    render(<RequestInbox />);

    expect(await screen.findByText('Trial call')).toBeInTheDocument();
  });

  it('confirms a request and then re-reads the queue it just changed', async () => {
    render(<RequestInbox />);
    await screen.findByText('Rohan Mehta');

    await userEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]!);

    await vi.waitFor(() => expect(api.confirmRequest).toHaveBeenCalledWith('b1'));
    expect(api.listRequests).toHaveBeenCalledTimes(2);
  });

  it('refuses through its own action, which is a decision rather than an edit', async () => {
    render(<RequestInbox />);
    await screen.findByText('Rohan Mehta');

    await userEvent.click(screen.getAllByRole('button', { name: 'Refuse' })[0]!);

    await vi.waitFor(() => expect(api.refuseRequest).toHaveBeenCalledWith('b1'));
    expect(api.confirmRequest).not.toHaveBeenCalled();
  });

  it('locks every row while one answer is on its way, so a double click cannot ask twice', async () => {
    let settle: (value: unknown) => void = () => {};
    api.confirmRequest.mockImplementationOnce(
      () => new Promise((resolve) => (settle = resolve as (value: unknown) => void)),
    );
    render(<RequestInbox />);
    await screen.findByText('Rohan Mehta');

    await userEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]!);
    const confirms = screen.getAllByRole('button', { name: 'Confirm' });
    expect(confirms.every((button) => button.hasAttribute('disabled'))).toBe(true);

    settle(undefined);
    await vi.waitFor(() => expect(api.listRequests).toHaveBeenCalledTimes(2));
  });

  it('turns a stale row into the refresh the API asked for, rather than a dead end', async () => {
    api.confirmRequest.mockRejectedValueOnce(
      new ApiError({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'This class changed while you were deciding. Refresh to see it.',
      }),
    );
    render(<RequestInbox />);
    await screen.findByText('Rohan Mehta');

    await userEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]!);

    expect(
      await screen.findByText('This class changed while you were deciding. Refresh to see it.'),
    ).toBeInTheDocument();
    // The queue is re-read so the row that is no longer pending disappears by itself.
    expect(api.listRequests).toHaveBeenCalledTimes(2);
  });

  it('says so when nothing is waiting', async () => {
    api.listRequests.mockResolvedValue([]);
    render(<RequestInbox />);

    expect(await screen.findByText(/nobody is asking/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'Confirm' })).toHaveLength(0);
  });

  it('offers a retry when the queue did not load', async () => {
    api.listRequests.mockRejectedValueOnce(new Error('The API is unreachable.'));
    render(<RequestInbox />);

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Rohan Mehta')).toBeInTheDocument();
  });
});
