import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutboxEntry, OutboxListResponse } from '@lms/shared';

import { OutboxTable } from './outbox-table';

const api = vi.hoisted(() => ({ listOutbox: vi.fn() }));
const session = vi.hoisted(() => ({ user: { fullName: 'Kirin Bora', timezone: 'UTC' } }));

vi.mock('@/lib/outbox', () => api);
vi.mock('./session-provider', () => ({
  useSession: () => ({ status: 'signed-in', user: session.user }),
}));

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 'o1',
    eventCode: 'booking_confirmed',
    eventLabel: 'Class confirmed',
    status: 'queued',
    statusLabel: 'Waiting',
    attempts: 0,
    nextAttemptAt: '2026-09-28T09:16:00.000Z',
    sentAt: null,
    failureReason: null,
    recipient: { id: 's1', fullName: 'Sima Kundu' },
    createdAt: '2026-09-28T09:15:00.000Z',
    ...overrides,
  };
}

function page(items: OutboxEntry[], overrides: Partial<OutboxListResponse> = {}) {
  return {
    items,
    page: 1,
    pageSize: 25,
    total: items.length,
    ...overrides,
  } satisfies OutboxListResponse;
}

beforeEach(() => {
  api.listOutbox.mockReset();
  session.user.timezone = 'UTC';
  api.listOutbox.mockResolvedValue(
    page([
      entry(),
      entry({
        id: 'o2',
        eventCode: 'enrollment_joined',
        eventLabel: 'Enrolled',
        status: 'failed',
        statusLabel: 'Failed',
        attempts: 6,
        nextAttemptAt: '2026-09-28T09:15:00.000Z',
        failureReason: 'smtp 550',
        recipient: { id: 's2', fullName: 'Nab Ahuja' },
        createdAt: '2026-09-28T08:00:00.000Z',
      }),
    ]),
  );
});

describe('OutboxTable', () => {
  it('names the news, the person it is for, and the state it reached', async () => {
    render(<OutboxTable />);
    await screen.findAllByRole('listitem');

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByRole('heading').textContent).toBe('Class confirmed');
    expect(within(rows[0] as HTMLElement).getByText('Sima Kundu')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Waiting')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Nab Ahuja')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Failed')).toBeInTheDocument();
  });

  it('prints the transport code a failed row stopped on, and says nothing for one that has not failed', async () => {
    render(<OutboxTable />);
    const rows = await screen.findAllByRole('listitem');

    expect(within(rows[1] as HTMLElement).getByText('smtp 550')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).queryByText(/smtp|reason/i)).not.toBeInTheDocument();
  });

  it('counts the whole queue from the API rather than the rows on this page', async () => {
    api.listOutbox.mockResolvedValue(page([entry()], { total: 61, pageSize: 25 }));

    render(<OutboxTable />);

    expect(await screen.findByText('61 letters')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('counts one letter in the singular', async () => {
    api.listOutbox.mockResolvedValue(page([entry()]));

    render(<OutboxTable />);

    expect(await screen.findByText('1 letter')).toBeInTheDocument();
  });

  it('filters by the state an operator picks, from the first page', async () => {
    render(<OutboxTable />);
    await screen.findAllByRole('listitem');

    await userEvent.selectOptions(screen.getByLabelText('State of the letter'), 'failed');

    await vi.waitFor(() =>
      expect(api.listOutbox).toHaveBeenLastCalledWith({ status: 'failed', page: 1 }),
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('pages a queue that does not fit, and keeps the state it was showing', async () => {
    api.listOutbox.mockResolvedValue(page([entry()], { total: 30, pageSize: 25 }));

    render(<OutboxTable />);
    await screen.findByText('Sima Kundu');

    await userEvent.selectOptions(screen.getByLabelText('State of the letter'), 'sending');
    await vi.waitFor(() =>
      expect(api.listOutbox).toHaveBeenLastCalledWith({ status: 'sending', page: 1 }),
    );

    api.listOutbox.mockResolvedValue(
      page([entry({ status: 'sending', statusLabel: 'Sending' })], {
        page: 2,
        total: 30,
        pageSize: 25,
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await vi.waitFor(() =>
      expect(api.listOutbox).toHaveBeenLastCalledWith({ status: 'sending', page: 2 }),
    );
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  it('says the queue is empty, and takes the filter off again', async () => {
    api.listOutbox.mockResolvedValue(page([]));

    render(<OutboxTable />);

    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('State of the letter'), 'failed');
    await userEvent.click(screen.getByRole('button', { name: /show the whole queue/i }));

    await vi.waitFor(() => expect(api.listOutbox).toHaveBeenLastCalledWith({ page: 1 }));
  });

  it('shows a refusal with a way to ask again', async () => {
    api.listOutbox.mockRejectedValueOnce(new Error('The API is unreachable.'));

    render(<OutboxTable />);

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Sima Kundu')).toBeInTheDocument();
  });

  it('names a person and a moment, and invents no letter and no address', async () => {
    render(<OutboxTable />);
    const list = await screen.findByRole('list');

    // The route reads no `payload` and carries no address; a screen that showed either would undo
    // the reason the columns are not there.
    expect(list.textContent).not.toContain('@');
    expect(list.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(list.textContent).not.toMatch(/subject|body/i);
  });

  it('reads a time in the operator zone the session carries', async () => {
    session.user.timezone = 'Asia/Kolkata';

    render(<OutboxTable />);
    const rows = await screen.findAllByRole('listitem');

    expect(within(rows[0] as HTMLElement).getByText('Mon 28 Sept, 14:45')).toBeInTheDocument();
  });
});
