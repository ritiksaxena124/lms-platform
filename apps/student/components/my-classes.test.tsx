import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, Booking } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { MyClasses } from './my-classes';

const bookings = vi.hoisted(() => ({ myBookings: vi.fn(), leaveClass: vi.fn() }));
const session = vi.hoisted(() => ({
  value: { status: 'signed-in' as string, user: null as AuthUser | null },
}));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const push = vi.hoisted(() => vi.fn());

vi.mock('@/lib/bookings', () => bookings);
vi.mock('./session-provider', () => ({ useSession: () => session.value }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

/** Monday 28 September 2026, 08:30 in Kolkata. */
const NOW = '2026-09-28T03:00:00.000Z';

const SAM: AuthUser = {
  id: 'u1',
  email: 'sam@example.test',
  fullName: 'Sam Iyer',
  role: 'student',
  status: 'active',
  timezone: 'Asia/Kolkata',
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-09-25T00:00:00.000Z',
};

/** 09:30–10:15 on Monday 28 Sept in Kolkata, and the same pair a week later. */
const MONDAY = '2026-09-28T04:00:00.000Z';
const MONDAY_END = '2026-09-28T04:45:00.000Z';
const LAST_MONDAY = '2026-09-21T04:00:00.000Z';
const LAST_MONDAY_END = '2026-09-21T04:45:00.000Z';

/** A class the API has confirmed, so it carries its door: the window the room opens in, from five
 * minutes before the first minute to a quarter of an hour after the last. */
const BOOKING_ONE: Booking = {
  id: '6a27',
  course: { id: 'b2a1', slug: 'fractions', title: 'Fractions, the slow way' },
  type: 'enrolled',
  status: 'confirmed',
  live: {
    opensAt: '2026-09-28T03:55:00.000Z',
    closesAt: '2026-09-28T05:00:00.000Z',
  },
  startsAt: MONDAY,
  endsAt: MONDAY_END,
  durationMinutes: 45,
  createdAt: '2026-09-27T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
};

/** A class that is not standing has no door, and the statuses below move off `confirmed`, so the
 * fixture closes it rather than sending a shape no response has. */
function booking(overrides: Partial<Booking> = {}): Booking {
  const row = { ...BOOKING_ONE, ...overrides };
  return row.status === 'confirmed' ? row : { ...row, live: null };
}

function refused(code: string, message: string) {
  return new ApiError({ statusCode: code === 'CONFLICT' ? 409 : 400, code, message });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  session.value = { status: 'signed-in', user: SAM };
  bookings.myBookings.mockReset().mockResolvedValue([]);
  bookings.leaveClass.mockReset().mockResolvedValue(booking({ status: 'cancelled' }));
  notify.success.mockReset();
  notify.error.mockReset();
  push.mockReset();
});

/**
 * The student's own calendar.
 *
 * Two of these tests care about which clock a row is read in, and they are the reason the screen
 * exists as its own file: the grid that offered the minute was drawn in the teacher's zone, and a
 * class that is Monday 09:30 there is Monday 15:00 here.
 */
describe('MyClasses', () => {
  it('lists the classes on the students own clock, with the words the API means', async () => {
    bookings.myBookings.mockResolvedValue([booking()]);

    render(<MyClasses />);

    await screen.findByText('Fractions, the slow way');
    expect(screen.getByText('Mon 28 Sept, 09:30–10:15')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText(/your clock, Asia\/Kolkata/)).toBeInTheDocument();
  });

  it('splits the schedule on the date, so a class that has been and gone cannot be upcoming', async () => {
    bookings.myBookings.mockResolvedValue([
      booking(),
      booking({ id: '9253', startsAt: LAST_MONDAY, endsAt: LAST_MONDAY_END, status: 'completed' }),
    ]);

    render(<MyClasses />);

    await screen.findByText('Coming up');
    const upcoming = await screen.findByLabelText('Coming up');
    const earlier = screen.getByLabelText('Earlier');

    expect(withinList(upcoming)).toContain('Mon 28 Sept');
    expect(withinList(earlier)).toContain('Mon 21 Sept');
  });

  it('keeps a called-off class in the week it was booked for', async () => {
    bookings.myBookings.mockResolvedValue([booking({ status: 'cancelled' })]);

    render(<MyClasses />);

    const upcoming = await screen.findByLabelText('Coming up');
    expect(withinList(upcoming)).toContain('Mon 28 Sept');
    expect(withinList(upcoming)).toContain('Cancelled');
  });

  it('offers the way out only on a class that is still standing', async () => {
    bookings.myBookings.mockResolvedValue([
      booking(),
      booking({ id: 'b2', status: 'pending' }),
      booking({ id: 'b3', status: 'cancelled' }),
      booking({
        id: 'b4',
        startsAt: LAST_MONDAY,
        endsAt: LAST_MONDAY_END,
        status: 'confirmed',
      }),
    ]);

    render(<MyClasses />);

    // Every row here carries the same course title, so the wait is on the section.
    await screen.findByLabelText('Coming up');
    // A request the teacher has not answered is still the student's to withdraw; a class that is
    // over, or already stood down, has nothing left to do here.
    expect(screen.getAllByRole('button', { name: /leave this class/i })).toHaveLength(2);
  });

  it('names a trial call as one', async () => {
    bookings.myBookings.mockResolvedValue([booking({ type: 'demo' })]);

    render(<MyClasses />);

    await screen.findByText('Trial call');
  });

  it('asks the API and then reads the list again, rather than writing the row out by hand', async () => {
    const user = userEvent.setup();
    bookings.myBookings.mockResolvedValue([booking()]);

    render(<MyClasses />);

    await user.click(await screen.findByRole('button', { name: /leave this class/i }));

    expect(bookings.leaveClass).toHaveBeenCalledWith('6a27');
    await waitFor(() => expect(bookings.myBookings).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Left Fractions, the slow way'),
    );
  });

  it('says so when the class moved underneath, and shows where it stands now', async () => {
    const user = userEvent.setup();
    bookings.myBookings.mockResolvedValue([booking()]);
    bookings.leaveClass.mockRejectedValueOnce(
      refused('CONFLICT', 'This class changed while you were deciding. Refresh to see it.'),
    );

    render(<MyClasses />);

    await user.click(await screen.findByRole('button', { name: /leave this class/i }));

    await screen.findByRole('status');
    expect(notify.error).not.toHaveBeenCalled();
    await waitFor(() => expect(bookings.myBookings).toHaveBeenCalledTimes(2));
  });

  it('keeps a refusal that is not about the class on the toast, where the list stays put', async () => {
    const user = userEvent.setup();
    bookings.myBookings.mockResolvedValue([booking()]);
    bookings.leaveClass.mockRejectedValueOnce(
      refused('VALIDATION_FAILED', 'That class does not belong to you.'),
    );

    render(<MyClasses />);

    await user.click(await screen.findByRole('button', { name: /leave this class/i }));

    await vi.waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(bookings.myBookings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('puts a list that never loaded where it can be retried', async () => {
    bookings.myBookings.mockRejectedValueOnce(refused('NETWORK_ERROR', 'The API is unreachable.'));
    const user = userEvent.setup();

    render(<MyClasses />);

    await screen.findByText('Your classes did not load');
    await user.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(bookings.myBookings).toHaveBeenCalledTimes(2));
  });

  it('sends a student with nothing booked to the shelf', async () => {
    const user = userEvent.setup();
    bookings.myBookings.mockResolvedValue([]);

    render(<MyClasses />);

    await screen.findByText(/No classes yet/);
    await user.click(screen.getByRole('button', { name: /browse the shelf/i }));
    expect(push).toHaveBeenCalledWith('/');
  });
});

/** The readable text of one section's rows, so a test can say which half a class landed in. */
function withinList(section: HTMLElement): string {
  return section.textContent ?? '';
}
