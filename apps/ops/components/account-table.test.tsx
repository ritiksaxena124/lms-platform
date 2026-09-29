import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpsAccount } from '@lms/shared';
import type * as lmsUi from '@lms/ui';

import { ApiError } from '@/lib/api';
import { AccountTable } from './account-table';

const api = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  setAccountStatus: vi.fn(),
  setAccountRole: vi.fn(),
}));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const session = vi.hoisted(() => ({
  user: { id: 'me1', fullName: 'Kirin Bora', timezone: 'UTC' },
}));

vi.mock('@/lib/accounts', () => api);
vi.mock('@lms/ui', async () => {
  const actual = await vi.importActual<typeof lmsUi>('@lms/ui');
  return { ...actual, notify };
});
vi.mock('./session-provider', () => ({
  useSession: () => ({ status: 'signed-in', user: session.user }),
}));

function account(overrides: Partial<OpsAccount> = {}): OpsAccount {
  return {
    id: 'a1',
    email: 'aditi@example.test',
    fullName: 'Aditi Sharma',
    roleCode: 'teacher',
    roleLabel: 'Teacher',
    statusCode: 'active',
    statusLabel: 'Active',
    lastLoginAt: '2026-09-28T09:15:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function page(
  items: OpsAccount[],
  overrides: Partial<{ page: number; pageSize: number; total: number }> = {},
) {
  return { items, page: 1, pageSize: 25, total: items.length, ...overrides };
}

beforeEach(() => {
  api.listAccounts.mockReset();
  api.setAccountStatus.mockReset();
  api.setAccountRole.mockReset();
  notify.success.mockReset();
  notify.error.mockReset();

  api.listAccounts.mockResolvedValue(
    page([
      account(),
      account({
        id: 'op2',
        email: 'ravi@example.test',
        fullName: 'Ravi Menon',
        roleCode: 'ops',
        roleLabel: 'Operations',
      }),
      account({
        id: 'me1',
        email: 'kirin@example.test',
        fullName: 'Kirin Bora',
        roleCode: 'ops',
        roleLabel: 'Operations',
      }),
    ]),
  );
  api.setAccountStatus.mockResolvedValue(
    account({ statusLabel: 'Disabled', statusCode: 'disabled' }),
  );
  api.setAccountRole.mockResolvedValue(account({ roleLabel: 'Operations', roleCode: 'ops' }));
});

describe('AccountTable', () => {
  it('names each account, what it is, and when it last got in', async () => {
    render(<AccountTable />);
    const rows = await screen.findAllByRole('listitem');

    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('Aditi Sharma')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('aditi@example.test')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Teacher')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Active')).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText(/Last in Mon 28 Sept, 09:15/),
    ).toBeInTheDocument();
  });

  it('asks for the search an operator types, from the first page', async () => {
    render(<AccountTable />);
    await screen.findAllByRole('listitem');

    await userEvent.type(screen.getByLabelText('Name or email'), 'aditi');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(api.listAccounts).toHaveBeenLastCalledWith({ q: 'aditi', page: 1 }));
  });

  it('asks for the role an operator picks, and keeps the search they already typed', async () => {
    render(<AccountTable />);
    await screen.findAllByRole('listitem');

    await userEvent.type(screen.getByLabelText('Name or email'), 'aditi');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'ops');

    await waitFor(() =>
      expect(api.listAccounts).toHaveBeenLastCalledWith({ q: 'aditi', role: 'ops', page: 1 }),
    );
  });

  it('counts the whole table rather than the rows on this page, and pages the rest', async () => {
    api.listAccounts.mockResolvedValue(page([account()], { total: 60, pageSize: 25 }));

    render(<AccountTable />);

    expect(await screen.findByText('60 accounts')).toBeInTheDocument();
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();

    api.listAccounts.mockResolvedValue(
      page([account({ id: 'a9', fullName: 'Nab Ahuja' })], { page: 2, total: 60 }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => expect(api.listAccounts).toHaveBeenLastCalledWith({ page: 2 }));
    expect(await screen.findByText('Nab Ahuja')).toBeInTheDocument();
  });

  it('disables an account and reads the row back from the answer, not from a guess', async () => {
    render(<AccountTable />);
    const [row] = await screen.findAllByRole('listitem');

    await userEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(api.setAccountStatus).toHaveBeenCalledWith('a1', 'disabled'));
    expect(await within(row as HTMLElement).findByText('Disabled')).toBeInTheDocument();
    expect(notify.success).toHaveBeenCalledWith('Aditi Sharma is disabled.');
  });

  it('gives a disabled account back', async () => {
    api.listAccounts.mockResolvedValue(
      page([account({ statusCode: 'disabled', statusLabel: 'Disabled' })]),
    );
    api.setAccountStatus.mockResolvedValue(
      account({ statusCode: 'active', statusLabel: 'Active' }),
    );

    render(<AccountTable />);
    const [row] = await screen.findAllByRole('listitem');

    await userEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(api.setAccountStatus).toHaveBeenCalledWith('a1', 'active'));
    expect(await within(row as HTMLElement).findByText('Active')).toBeInTheDocument();
  });

  it('issues the ops role to the account an operator chooses', async () => {
    render(<AccountTable />);
    const [row] = await screen.findAllByRole('listitem');

    await userEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Make ops' }));

    await waitFor(() => expect(api.setAccountRole).toHaveBeenCalledWith('a1', 'ops'));
    expect(await within(row as HTMLElement).findByText('Operations')).toBeInTheDocument();
    expect(notify.success).toHaveBeenCalledWith('Aditi Sharma can open this desk.');
  });

  it('asks an operator where a revoked colleague should land, and offers no answer for themselves', async () => {
    render(<AccountTable />);
    const [, colleague, own] = await screen.findAllByRole('listitem');

    // The route answers a revocation with a role rather than a flag, so the screen asks for one:
    // an account with no role could not open either portal, and a screen that picked for the person
    // would be guessing at somebody's history from a button.
    const revokeTo = within(colleague as HTMLElement).getByLabelText('Revoke to');
    expect(within(colleague as HTMLElement).getByRole('button', { name: 'Revoke' })).toBeDisabled();

    await userEvent.selectOptions(revokeTo, 'student');
    expect(within(colleague as HTMLElement).getByRole('button', { name: 'Revoke' })).toBeEnabled();

    await userEvent.click(within(colleague as HTMLElement).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.setAccountRole).toHaveBeenCalledWith('op2', 'student'));

    expect(within(own as HTMLElement).queryByLabelText('Revoke to')).not.toBeInTheDocument();
  });

  it('refuses to move the account sitting in the chair, and says why in the row', async () => {
    render(<AccountTable />);
    const [, , own] = await screen.findAllByRole('listitem');

    expect(within(own as HTMLElement).getByText('This is your account')).toBeInTheDocument();
    expect(
      within(own as HTMLElement).queryByRole('button', { name: 'Disable' }),
    ).not.toBeInTheDocument();
    expect(
      within(own as HTMLElement).queryByRole('button', { name: 'Make ops' }),
    ).not.toBeInTheDocument();
  });

  it('shows the API’s reason when it refuses, and leaves the row as it was', async () => {
    api.setAccountStatus.mockRejectedValue(
      new ApiError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'You cannot change the status of your own account.',
      }),
    );

    render(<AccountTable />);
    const [row] = await screen.findAllByRole('listitem');

    await userEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Disable' }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'You cannot change the status of your own account.',
      ),
    );
    expect(within(row as HTMLElement).getByText('Active')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole('button', { name: 'Disable' })).toBeEnabled();
  });

  it('says so when no account answers the search', async () => {
    api.listAccounts.mockResolvedValue(page([]));

    render(<AccountTable />);

    await userEvent.type(screen.getByLabelText('Name or email'), 'nobody');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/no account matches/i)).toBeInTheDocument();
  });

  it('shows a refusal to read with a way to ask again', async () => {
    api.listAccounts.mockRejectedValueOnce(new Error('The API is unreachable.'));

    render(<AccountTable />);

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Aditi Sharma')).toBeInTheDocument();
  });
});
