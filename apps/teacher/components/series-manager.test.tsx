import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClassSeries } from '@lms/shared';

import { SeriesManager } from './series-manager';

const api = vi.hoisted(() => ({
  listSeries: vi.fn(),
  addSeries: vi.fn(),
  updateSeries: vi.fn(),
  retireSeries: vi.fn(),
}));

vi.mock('@/lib/calendar', () => api);

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

function seriesOf(overrides: Partial<ClassSeries> = {}): ClassSeries {
  return {
    id: 's1',
    courseId: 'c1',
    weekday: 1,
    startMinutes: 540,
    endMinutes: 600,
    durationMinutes: 45,
    isActive: true,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

/** A row is one button whose name carries the day and the window, so `byRow` reads the list the
 * way a teacher does rather than by position. */
async function byRow(name: RegExp) {
  return screen.findByRole('button', { name });
}

beforeEach(() => {
  api.listSeries.mockReset();
  api.addSeries.mockReset();
  api.updateSeries.mockReset();
  api.retireSeries.mockReset();
  api.listSeries.mockResolvedValue([seriesOf()]);
  api.addSeries.mockResolvedValue(seriesOf({ id: 's2' }));
  api.updateSeries.mockResolvedValue(seriesOf());
  api.retireSeries.mockResolvedValue(seriesOf({ isActive: false }));
});

describe('SeriesManager', () => {
  it('shows each series as the week reads it: the day, the window, the class', async () => {
    api.listSeries.mockResolvedValue([
      seriesOf(),
      seriesOf({
        id: 's2',
        weekday: 4,
        startMinutes: 1080,
        endMinutes: 1130,
        durationMinutes: 30,
      }),
    ]);

    render(<SeriesManager courseId="c1" />);

    const monday = await byRow(/Monday/);
    expect(within(monday).getByText('09:00–10:00 (45 min)')).toBeInTheDocument();

    const thursday = screen.getByRole('button', { name: /Thursday/ });
    expect(within(thursday).getByText('18:00–18:50 (30 min)')).toBeInTheDocument();
  });

  it('sends the window the teacher typed, not the one the form started with', async () => {
    render(<SeriesManager courseId="c1" />);
    await byRow(/Monday/);

    await userEvent.clear(screen.getByLabelText(/^Opens/));
    await userEvent.type(screen.getByLabelText(/^Opens/), '07:30');
    await userEvent.clear(screen.getByLabelText(/^Closes/));
    await userEvent.type(screen.getByLabelText(/^Closes/), '09:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add series' }));

    await vi.waitFor(() =>
      expect(api.addSeries).toHaveBeenCalledWith('c1', {
        weekday: 1,
        startMinutes: 450,
        endMinutes: 540,
        durationMinutes: 45,
      }),
    );
    expect(api.listSeries).toHaveBeenCalledTimes(2);
  });

  it('keeps a class that does not fit its window on the page and asks the API nothing', async () => {
    render(<SeriesManager courseId="c1" />);
    await byRow(/Monday/);

    await userEvent.clear(screen.getByLabelText(/^Class length/));
    await userEvent.type(screen.getByLabelText(/^Class length/), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Add series' }));

    expect(await screen.findByText(/does not fit inside the window/i)).toBeInTheDocument();
    expect(api.addSeries).not.toHaveBeenCalled();
  });

  it('refuses a series whose window ends before it opens', async () => {
    render(<SeriesManager courseId="c1" />);
    await byRow(/Monday/);

    await userEvent.clear(screen.getByLabelText(/^Closes/));
    await userEvent.type(screen.getByLabelText(/^Closes/), '08:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add series' }));

    expect(await screen.findByText(/must end after it starts/i)).toBeInTheDocument();
    expect(api.addSeries).not.toHaveBeenCalled();
  });

  it('loads a series into the form when it is picked, and edits that one', async () => {
    api.listSeries.mockResolvedValue([
      seriesOf(),
      seriesOf({ id: 's2', weekday: 3, startMinutes: 900, endMinutes: 960, durationMinutes: 60 }),
    ]);

    render(<SeriesManager courseId="c1" />);

    await userEvent.click(await byRow(/Wednesday/));

    expect(screen.getByLabelText(/^Opens/)).toHaveValue('15:00');

    await userEvent.clear(screen.getByLabelText(/^Class length/));
    await userEvent.type(screen.getByLabelText(/^Class length/), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Update series' }));

    await vi.waitFor(() =>
      expect(api.updateSeries).toHaveBeenCalledWith('c1', 's2', {
        weekday: 3,
        startMinutes: 900,
        endMinutes: 960,
        durationMinutes: 30,
      }),
    );
  });

  it('retires the series that is open in the form, by its own id', async () => {
    api.listSeries.mockResolvedValue([
      seriesOf({ id: 's1' }),
      seriesOf({ id: 's9', weekday: 2, startMinutes: 660, endMinutes: 690, durationMinutes: 30 }),
    ]);

    render(<SeriesManager courseId="c1" />);

    await userEvent.click(await byRow(/Monday/));
    await userEvent.click(screen.getByRole('button', { name: 'Retire this series' }));

    await vi.waitFor(() => expect(api.retireSeries).toHaveBeenCalledWith('c1', 's1'));
    expect(api.retireSeries).not.toHaveBeenCalledWith('c1', 's9');
  });

  it('lets go of the form once the series it was editing is retired', async () => {
    render(<SeriesManager courseId="c1" />);

    await userEvent.click(await byRow(/Monday/));
    await userEvent.click(screen.getByRole('button', { name: 'Retire this series' }));

    await vi.waitFor(() => expect(api.retireSeries).toHaveBeenCalled());

    // The row it belonged to is gone from the list, so a form still addressed to that id would
    // be editing something the teacher can no longer see.
    expect(screen.getByRole('button', { name: 'Add series' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retire this series' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Opens/)).toHaveValue('09:00');
  });

  it('says the list failed and asks for the same page again', async () => {
    api.listSeries.mockRejectedValueOnce(new Error('The API is unreachable.'));

    render(<SeriesManager courseId="c1" />);

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    await vi.waitFor(() => expect(api.listSeries).toHaveBeenCalledTimes(2));
    expect(await byRow(/Monday/)).toBeInTheDocument();
  });

  it('shows nothing but the add form when the course has no series yet', async () => {
    api.listSeries.mockResolvedValue([]);

    render(<SeriesManager courseId="c1" />);

    expect(await screen.findByText(/no series yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /09:00–10:00/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add series' })).toBeInTheDocument();
  });
});
