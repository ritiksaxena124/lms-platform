import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduledClass, TeachingClassesResponse } from '@lms/shared';

import { ApiError } from '@/lib/api';

import { CohortCalendar } from './cohort-calendar';

const api = vi.hoisted(() => ({ myTeachingClasses: vi.fn() }));
const session = vi.hoisted(() => ({
  value: { status: 'signed-in', user: { timezone: 'Asia/Kolkata' } },
}));

vi.mock('@/lib/cohort-classes', () => api);
vi.mock('./session-provider', () => ({ useSession: () => session.value }));

/** Monday 28 September 2026, 08:30 in Kolkata, and the horizon the sweep keeps behind it. */
const NOW = '2026-09-28T03:00:00.000Z';
const FROM = NOW;
const TO = '2026-10-28T03:00:00.000Z';

function scheduled(overrides: Partial<ScheduledClass> = {}): ScheduledClass {
  return {
    id: 'o1',
    seriesId: 's1',
    course: { id: 'c1', slug: 'veena-basics', title: 'Veena Basics' },
    startsAt: '2026-09-28T04:00:00.000Z',
    endsAt: '2026-09-28T04:45:00.000Z',
    durationMinutes: 45,
    studentsExpected: 6,
    ...overrides,
  };
}

function horizon(items: ScheduledClass[]): TeachingClassesResponse {
  return { from: FROM, to: TO, items };
}

function grid(label: string): HTMLElement {
  const found = screen.queryByRole('group', { name: label });
  if (!found) throw new Error(`no calendar named "${label}" on the page`);
  return found as HTMLElement;
}

function column(weekLabel: string, key: string): HTMLElement {
  const found = within(grid(weekLabel))
    .getAllByRole('listitem')
    .find((day) => day.getAttribute('data-key') === key);
  if (!found) throw new Error(`no column for ${key} in ${weekLabel}`);
  return found;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  api.myTeachingClasses.mockReset().mockResolvedValue(horizon([scheduled()]));
});

/**
 * The teacher's dated calendar.
 *
 * Three of these tests are about the difference between a calendar and a control panel: a class
 * the sweep wrote is a fact about a minute, and nothing on this screen may dress a fact as a
 * button. The rest care about the week the teacher is looking at being the week the horizon
 * reaches, in the zone the teacher keeps.
 */
describe('CohortCalendar', () => {
  it('draws the week the calendar opened inside, with the class on its own day', async () => {
    render(<CohortCalendar />);

    await screen.findByRole('group', { name: 'Week of 28 Sept' });
    expect(within(grid('Week of 28 Sept')).getAllByRole('listitem')).toHaveLength(7);
    expect(column('Week of 28 Sept', '2026-09-28')).toHaveTextContent('09:30–10:15');
  });

  it('keeps a dated class off the buttons', async () => {
    render(<CohortCalendar />);
    await screen.findByRole('group', { name: 'Week of 28 Sept' });

    // No route on this side of the platform writes a class onto a teacher's calendar, so a chip
    // that pressed would be a control the API refuses the moment it is used.
    expect(screen.queryByRole('button', { name: /Veena Basics/ })).toBeNull();
    expect(column('Week of 28 Sept', '2026-09-28').textContent).toContain('09:30–10:15');
  });

  it('says whose clock the week is written on', async () => {
    render(<CohortCalendar />);

    expect(await screen.findByText(/Asia\/Kolkata/)).toBeInTheDocument();
  });

  it('lists the week’s classes with the course, the window and the roll beside them', async () => {
    render(<CohortCalendar />);

    const link = await screen.findByRole('link', { name: 'Veena Basics' });
    expect(link).toHaveAttribute('href', '/courses/c1');
    expect(screen.getByText('Mon 28 Sept, 09:30–10:15')).toBeInTheDocument();
    expect(screen.getByText('6 students expected')).toBeInTheDocument();
  });

  it('counts one student as one student', async () => {
    api.myTeachingClasses.mockResolvedValue(horizon([scheduled({ studentsExpected: 1 })]));

    render(<CohortCalendar />);

    expect(await screen.findByText('1 student expected')).toBeInTheDocument();
  });

  it('pages forward a week at a time and stops where the calendar stops', async () => {
    const user = userEvent.setup();
    api.myTeachingClasses.mockResolvedValue(
      horizon([
        scheduled({ startsAt: '2026-10-05T04:00:00.000Z', endsAt: '2026-10-05T04:45:00.000Z' }),
      ]),
    );

    render(<CohortCalendar />);
    await screen.findByRole('group', { name: 'Week of 28 Sept' });

    // Four presses reach the last week the horizon covers; a fifth would be a week no class can
    // stand in, and the arrow says so rather than drawing an empty grid.
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByRole('group', { name: 'Week of 5 Oct' })).toBeInTheDocument();

    for (let week = 0; week < 3; week += 1) {
      await user.click(screen.getByRole('button', { name: 'Next week' }));
    }
    expect(screen.getByRole('group', { name: 'Week of 26 Oct' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByRole('group', { name: 'Week of 19 Oct' })).toBeInTheDocument();
  });

  it('says so when the week it is showing has nothing in it', async () => {
    api.myTeachingClasses.mockResolvedValue(
      horizon([
        scheduled({ startsAt: '2026-10-19T04:00:00.000Z', endsAt: '2026-10-19T04:45:00.000Z' }),
      ]),
    );

    render(<CohortCalendar />);
    await screen.findByRole('group', { name: 'Week of 28 Sept' });

    expect(column('Week of 28 Sept', '2026-09-29')).toHaveTextContent('No class');
    expect(screen.getByText(/Nothing is scheduled for this week/i)).toBeInTheDocument();
  });

  it('sends a teacher with an empty calendar to the plan that writes one', async () => {
    api.myTeachingClasses.mockResolvedValue(horizon([]));

    render(<CohortCalendar />);

    expect(await screen.findByText(/no classes on your calendar yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open your courses/i })).toHaveAttribute(
      'href',
      '/courses',
    );
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('shows a calendar that never loaded with a way to ask again', async () => {
    const user = userEvent.setup();
    api.myTeachingClasses.mockRejectedValueOnce(
      new ApiError({ statusCode: 500, code: 'INTERNAL', message: 'The calendar did not answer.' }),
    );

    render(<CohortCalendar />);

    await screen.findByText('Your calendar did not load');
    await user.click(screen.getByRole('button', { name: /try again/i }));

    await vi.waitFor(() => expect(api.myTeachingClasses).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('group', { name: 'Week of 28 Sept' })).toBeInTheDocument();
  });
});
