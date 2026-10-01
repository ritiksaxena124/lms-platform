import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Holiday } from '@lms/shared';

import { HolidayManager } from './holiday-manager';

// Hoisted: `vi.mock` calls move above the imports, so a factory may only close over values that
// exist before this file's body runs.
const api = vi.hoisted(() => ({
  listHolidays: vi.fn(),
  addHoliday: vi.fn(),
  updateHoliday: vi.fn(),
  retireHoliday: vi.fn(),
}));

vi.mock('@/lib/holidays', () => api);

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

function holiday(overrides: Partial<Holiday> = {}): Holiday {
  return {
    id: 'h1',
    teacherUserId: 't1',
    date: '2026-12-25',
    reason: 'Diwali',
    isRecurringAnnual: true,
    isActive: true,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  api.listHolidays.mockReset();
  api.addHoliday.mockReset();
  api.updateHoliday.mockReset();
  api.retireHoliday.mockReset();
  api.listHolidays.mockResolvedValue([holiday()]);
  api.addHoliday.mockResolvedValue(holiday({ id: 'h2' }));
  api.updateHoliday.mockResolvedValue(holiday());
  api.retireHoliday.mockResolvedValue(holiday({ isActive: false }));
});

describe('HolidayManager', () => {
  it('shows each holiday with its reason and whether it repeats', async () => {
    api.listHolidays.mockResolvedValue([
      holiday(),
      holiday({ id: 'h2', date: '2026-10-02', reason: null, isRecurringAnnual: false }),
    ]);

    render(<HolidayManager />);

    const diwali = await screen.findByRole('button', { name: /2026-12-25/ });
    expect(within(diwali).getByText(/Diwali/)).toBeInTheDocument();
    expect(within(diwali).getByText(/Recurs annually/)).toBeInTheDocument();

    const oneOff = screen.getByRole('button', { name: /2026-10-02/ });
    expect(within(oneOff).getByText(/No reason given/)).toBeInTheDocument();
    expect(within(oneOff).queryByText(/Recurs annually/)).not.toBeInTheDocument();
  });

  it('sends the day, reason and recurrence the teacher typed', async () => {
    render(<HolidayManager />);
    await screen.findByRole('button', { name: /2026-12-25/ });

    await userEvent.type(screen.getByLabelText(/^Date/), '2027-04-14');
    await userEvent.type(screen.getByLabelText(/Reason/), 'Ugadi');
    await userEvent.click(screen.getByLabelText(/Recur annually/));
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));

    await vi.waitFor(() =>
      expect(api.addHoliday).toHaveBeenCalledWith({
        date: '2027-04-14',
        reason: 'Ugadi',
        isRecurringAnnual: true,
      }),
    );
    expect(api.listHolidays).toHaveBeenCalledTimes(2);
  });

  it('keeps a date that is not YYYY-MM-DD on the page and asks the API nothing', async () => {
    render(<HolidayManager />);
    await screen.findByRole('button', { name: /2026-12-25/ });

    await userEvent.type(screen.getByLabelText(/^Date/), '25/12/2026');
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));

    expect(await screen.findByText(/YYYY-MM-DD/)).toBeInTheDocument();
    expect(api.addHoliday).not.toHaveBeenCalled();
  });

  it('loads a holiday into the form when it is picked, and edits that one', async () => {
    api.listHolidays.mockResolvedValue([
      holiday(),
      holiday({ id: 'h9', date: '2026-08-15', reason: 'Independence Day', isRecurringAnnual: false }),
    ]);

    render(<HolidayManager />);

    await userEvent.click(await screen.findByRole('button', { name: /2026-08-15/ }));

    expect(screen.getByLabelText(/^Date/)).toHaveValue('2026-08-15');
    expect(screen.getByLabelText(/Reason/)).toHaveValue('Independence Day');
    expect(screen.getByLabelText(/Recur annually/)).not.toBeChecked();

    await userEvent.click(screen.getByLabelText(/Recur annually/));
    await userEvent.click(screen.getByRole('button', { name: 'Update holiday' }));

    await vi.waitFor(() =>
      expect(api.updateHoliday).toHaveBeenCalledWith('h9', {
        date: '2026-08-15',
        reason: 'Independence Day',
        isRecurringAnnual: true,
      }),
    );
  });

  it('retires the holiday that is open in the form, by its own id', async () => {
    api.listHolidays.mockResolvedValue([holiday({ id: 'h1' }), holiday({ id: 'h9', date: '2026-11-01' })]);

    render(<HolidayManager />);

    await userEvent.click(await screen.findByRole('button', { name: /2026-11-01/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Retire this holiday' }));

    await vi.waitFor(() => expect(api.retireHoliday).toHaveBeenCalledWith('h9'));
    expect(api.retireHoliday).not.toHaveBeenCalledWith('h1');
  });

  it('lets go of the form once the holiday it was editing is retired', async () => {
    render(<HolidayManager />);

    await userEvent.click(await screen.findByRole('button', { name: /2026-12-25/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Retire this holiday' }));

    await vi.waitFor(() => expect(api.retireHoliday).toHaveBeenCalled());

    // The row leaves the list, so a form still addressed to that id would be editing a holiday
    // the teacher can no longer see.
    expect(screen.getByRole('button', { name: 'Add holiday' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retire this holiday' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Date/)).toHaveValue('');
  });

  it('says the list failed and asks for the same page again', async () => {
    api.listHolidays.mockRejectedValueOnce(new Error('The API is unreachable.'));

    render(<HolidayManager />);

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    await vi.waitFor(() => expect(api.listHolidays).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: /2026-12-25/ })).toBeInTheDocument();
  });

  it('shows nothing but the add form when nothing has been blocked yet', async () => {
    api.listHolidays.mockResolvedValue([]);

    render(<HolidayManager />);

    expect(await screen.findByText(/no holidays yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /2026-12-25/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add holiday' })).toBeInTheDocument();
  });
});
