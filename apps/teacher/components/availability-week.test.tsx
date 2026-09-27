import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AvailabilityRule } from '@lms/shared';

import { ApiError } from '@/lib/api';

import { AvailabilityWeek } from './availability-week';

const api = vi.hoisted(() => ({
  listWindows: vi.fn(),
  openWindow: vi.fn(),
  moveWindow: vi.fn(),
  closeWindow: vi.fn(),
}));

vi.mock('@/lib/availability', () => api);
vi.mock('./session-provider', () => ({
  useSession: () => ({ status: 'signed-in', user: { timezone: 'Asia/Kolkata' } }),
}));

function window(overrides: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return {
    id: 'r1',
    weekday: 1,
    startMinutes: 540,
    endMinutes: 630,
    slotMinutes: 30,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

const WEEK = [
  window(),
  window({ id: 'r2', weekday: 1, startMinutes: 660, endMinutes: 750 }),
  window({ id: 'r3', weekday: 4, startMinutes: 1080, endMinutes: 1200, slotMinutes: 60 }),
];

async function columns() {
  return screen.findAllByRole('listitem');
}

beforeEach(() => {
  api.listWindows.mockReset().mockResolvedValue(WEEK);
  api.openWindow.mockReset().mockResolvedValue(WEEK[0]);
  api.moveWindow.mockReset().mockResolvedValue(WEEK[0]);
  api.closeWindow.mockReset().mockResolvedValue(WEEK[0]);
});

describe('AvailabilityWeek', () => {
  it('draws seven days and puts each window on the one it belongs to', async () => {
    render(<AvailabilityWeek />);
    const first = await columns();

    expect(first).toHaveLength(7);
    const [monday, tuesday, , thursday] = first;

    expect(
      within(monday as HTMLElement)
        .getAllByText(/–/)
        .map((chip) => chip.textContent),
    ).toEqual(['09:00–10:30', '11:00–12:30']);
    expect(within(tuesday as HTMLElement).getByText('No window')).toBeInTheDocument();
    expect(within(thursday as HTMLElement).getByText('18:00–20:00')).toBeInTheDocument();
  });

  it('says whose clock the week is written on', async () => {
    render(<AvailabilityWeek />);

    expect(await screen.findByText(/Asia\/Kolkata/)).toBeInTheDocument();
  });

  it('names a window out loud with the class length it carries', async () => {
    render(<AvailabilityWeek />);
    await columns();

    const chip = screen.getByRole('button', {
      name: /Monday 09:00–10:30 · 30-minute classes/,
    });
    expect(chip).toBeInTheDocument();
  });

  it('opens a window from the form, in minutes rather than clock faces', async () => {
    render(<AvailabilityWeek />);
    await columns();

    await userEvent.selectOptions(screen.getByLabelText('Day'), ['5']);
    await userEvent.clear(screen.getByLabelText('Opens'));
    await userEvent.type(screen.getByLabelText('Opens'), '07:30');
    await userEvent.clear(screen.getByLabelText('Closes'));
    await userEvent.type(screen.getByLabelText('Closes'), '09:00');
    await userEvent.clear(screen.getByLabelText('Class length'));
    await userEvent.type(screen.getByLabelText('Class length'), '45');
    await userEvent.click(screen.getByRole('button', { name: 'Add window' }));

    await vi.waitFor(() =>
      expect(api.openWindow).toHaveBeenCalledWith({
        weekday: 5,
        startMinutes: 450,
        endMinutes: 540,
        slotMinutes: 45,
      }),
    );
  });

  it('asks for the week again after a window opens, so the grid is the API’s', async () => {
    render(<AvailabilityWeek />);
    await columns();
    expect(api.listWindows).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Add window' }));

    await vi.waitFor(() => expect(api.listWindows).toHaveBeenCalledTimes(2));
  });

  it('marks the box the API named, and keeps what was typed', async () => {
    api.openWindow.mockRejectedValueOnce(
      new ApiError({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Check the highlighted fields.',
        details: {
          validation: { startMinutes: ['Friday 09:00–10:30 already has a window in it.'] },
        },
      }),
    );

    render(<AvailabilityWeek />);
    await columns();

    await userEvent.click(screen.getByRole('button', { name: 'Add window' }));

    expect(
      await screen.findByText('Friday 09:00–10:30 already has a window in it.'),
    ).toBeInTheDocument();
    expect((screen.getByLabelText('Opens') as HTMLInputElement).value).toBe('09:00');
    expect(api.listWindows).toHaveBeenCalledTimes(1);
  });

  it('loads a window into the form when it is pressed, and saves it back as a move', async () => {
    render(<AvailabilityWeek />);
    await columns();

    await userEvent.click(
      screen.getByRole('button', { name: /Thursday 18:00–20:00 · 60-minute classes/ }),
    );

    expect((screen.getByLabelText('Day') as HTMLSelectElement).value).toBe('4');
    expect((screen.getByLabelText('Opens') as HTMLInputElement).value).toBe('18:00');

    await userEvent.clear(screen.getByLabelText('Closes'));
    await userEvent.type(screen.getByLabelText('Closes'), '21:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save window' }));

    await vi.waitFor(() =>
      expect(api.moveWindow).toHaveBeenCalledWith('r3', {
        weekday: 4,
        startMinutes: 1080,
        endMinutes: 1260,
        slotMinutes: 60,
      }),
    );
  });

  it('closes a window through its own route, and leaves nothing selected', async () => {
    render(<AvailabilityWeek />);
    await columns();

    await userEvent.click(screen.getByRole('button', { name: /Monday 09:00–10:30/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Close this window' }));

    await vi.waitFor(() => expect(api.closeWindow).toHaveBeenCalledWith('r1'));
    expect((screen.getByLabelText('Day') as HTMLSelectElement).value).toBe('1');
  });

  it('says so when the week has no windows at all, and still offers the form', async () => {
    api.listWindows.mockResolvedValue([]);

    render(<AvailabilityWeek />);

    expect(await screen.findByText(/no windows yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add window' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows a failed load with a way to ask again', async () => {
    api.listWindows.mockRejectedValueOnce(new Error('The API is unreachable.'));

    render(<AvailabilityWeek />);

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('09:00–10:30')).toBeInTheDocument();
    expect(api.listWindows).toHaveBeenCalledTimes(2);
  });
});
