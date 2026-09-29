import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionLogEntry, ActionListResponse } from '@lms/shared';

import { ActivityLog } from './activity-log';

// Hoisted: `vi.mock` calls move above the imports, so a factory may only close over values that
// exist before this file's body runs.
const api = vi.hoisted(() => ({ listActions: vi.fn() }));
const session = vi.hoisted(() => ({ user: { fullName: 'Kirin Bora', timezone: 'UTC' } }));

vi.mock('@/lib/actions', () => ({ listActions: api.listActions }));
vi.mock('./session-provider', () => ({
  useSession: () => ({ status: 'signed-in', user: session.user }),
}));

function entry(overrides: Partial<ActionLogEntry> = {}): ActionLogEntry {
  return {
    id: 'a1',
    actionCode: 'booking_confirmed',
    sectionCode: 'booking',
    actorKind: 'user',
    targetTable: 'booking',
    targetId: 'b1',
    detail: { status_from: 'pending', status_to: 'confirmed' },
    actor: { id: 'u1', fullName: 'Aditi Sharma', roleCode: 'teacher' },
    requestId: 'r1',
    createdAt: '2026-09-28T09:15:00.000Z',
    ...overrides,
  };
}

function page(items: ActionLogEntry[], overrides: Partial<ActionListResponse> = {}) {
  return {
    items,
    page: 1,
    pageSize: 25,
    total: items.length,
    ...overrides,
  } satisfies ActionListResponse;
}

beforeEach(() => {
  api.listActions.mockReset();
  api.listActions.mockResolvedValue(
    page([
      entry(),
      entry({
        id: 'a2',
        actionCode: 'signed_in',
        sectionCode: 'account',
        targetTable: 'users',
        detail: {},
        actor: { id: 'u2', fullName: 'Nab Ahuja', roleCode: 'student' },
        createdAt: '2026-09-27T23:40:00.000Z',
      }),
    ]),
  );
});

describe('ActivityLog', () => {
  it('names who did it, what they did and when they did it', async () => {
    render(<ActivityLog />);
    const rows = await screen.findAllByRole('listitem');

    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Aditi Sharma')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Class confirmed')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Mon 28 Sept, 09:15')).toBeInTheDocument();
  });

  it('reads a scheduler row as the machine’s work, and does not borrow a name for it', async () => {
    api.listActions.mockResolvedValue(
      page([
        entry({
          actionCode: 'booking_expired',
          actorKind: 'system',
          detail: { requested_at: '2026-09-26T09:00:00.000Z' },
          actor: null,
          requestId: null,
        }),
      ]),
    );

    render(<ActivityLog />);
    const [row] = await screen.findAllByRole('listitem');

    expect(within(row as HTMLElement).getByText('The scheduler')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Request expired')).toBeInTheDocument();
  });

  it('keeps the half-second an instant arrived out of the sentence, and keeps the facts in', async () => {
    render(<ActivityLog />);
    const [row] = await screen.findAllByRole('listitem');

    expect(within(row as HTMLElement).getByText('status_from: pending')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('status_to: confirmed')).toBeInTheDocument();
  });

  it('counts the whole log rather than the rows on this page', async () => {
    api.listActions.mockResolvedValue(page([entry()], { total: 412 }));

    render(<ActivityLog />);

    expect(await screen.findByText('412 logged actions')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('asks the ledger for the section an operator picks, from the first page again', async () => {
    render(<ActivityLog />);
    await screen.findAllByRole('listitem');

    await userEvent.selectOptions(screen.getByLabelText('Part of the platform'), 'booking');

    await vi.waitFor(() =>
      expect(api.listActions).toHaveBeenCalledWith({ section: 'booking', page: 1 }),
    );
  });

  it('pages a log that does not fit, and keeps the section it was showing', async () => {
    api.listActions.mockResolvedValue(page([entry()], { total: 60, pageSize: 25 }));

    render(<ActivityLog />);
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Part of the platform'), 'account');
    api.listActions.mockResolvedValue(page([entry()], { page: 2, total: 60 }));

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await vi.waitFor(() =>
      expect(api.listActions).toHaveBeenLastCalledWith({ section: 'account', page: 2 }),
    );
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('says so when the ledger holds nothing for that question', async () => {
    api.listActions.mockResolvedValue(page([]));

    render(<ActivityLog />);

    expect(await screen.findByText(/nothing recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows a refusal with a way to ask again, and asks for the page it was on', async () => {
    api.listActions.mockRejectedValueOnce(new Error('The API is unreachable.'));

    render(<ActivityLog />);

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Aditi Sharma')).toBeInTheDocument();
    expect(api.listActions).toHaveBeenLastCalledWith({ page: 1 });
  });

  it('says a name and a code, and shows no address and no uuid', async () => {
    render(<ActivityLog />);
    const list = await screen.findByRole('list');

    // The API keeps an address off the ledger (§18), and a uuid on screen is noise an operator
    // cannot act on — the row they want is one click away in the account, not one character away.
    expect(list.textContent).not.toContain('@');
    expect(list.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
  });
});
