import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, OpenSlotsResponse } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { BookAClass } from './book-a-class';

const bookings = vi.hoisted(() => ({ openSlotsFor: vi.fn(), bookSlot: vi.fn(), myBookings: vi.fn() }));
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

/** Monday 28 September 2026, 08:30 in Kolkata — mid-morning, inside the horizon. */
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

const MONDAY = '2026-09-28T04:00:00.000Z';
const NEXT_MONDAY = '2026-10-05T04:00:00.000Z';

function offer(overrides: Partial<OpenSlotsResponse> = {}): OpenSlotsResponse {
  return {
    course: { id: 'b2a1', slug: 'fractions', title: 'Fractions, the slow way', demoBookingsEnabled: true },
    teacher: { id: 't1', timezone: 'Asia/Kolkata' },
    entitlement: 'enrolled',
    denial: null,
    from: NOW,
    to: '2026-10-27T03:00:00.000Z',
    slots: [
      { startsAt: MONDAY, endsAt: '2026-09-28T04:45:00.000Z' },
      { startsAt: NEXT_MONDAY, endsAt: '2026-10-05T04:45:00.000Z' },
    ],
    ...overrides,
  };
}

function held(status = 'pending') {
  return {
    id: '6a27',
    course: { id: 'b2a1', slug: 'fractions', title: 'Fractions, the slow way' },
    type: 'enrolled' as const,
    status: status as 'pending' | 'confirmed',
    startsAt: '2026-09-28T06:00:00.000Z',
    endsAt: '2026-09-28T06:45:00.000Z',
    durationMinutes: 45,
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
  };
}

function refused(code: string, message: string) {
  return new ApiError({ statusCode: code === 'CONFLICT' ? 409 : 400, code, message });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  session.value = { status: 'signed-in', user: SAM };
  bookings.openSlotsFor.mockReset().mockResolvedValue(offer());
  bookings.myBookings.mockReset().mockResolvedValue([]);
  bookings.bookSlot.mockReset().mockResolvedValue(held());
  notify.success.mockReset();
  notify.error.mockReset();
  push.mockReset();
});

describe('BookAClass', () => {
  it('offers only the open minutes as buttons', async () => {
    bookings.myBookings.mockResolvedValue([held()]);
    render(<BookAClass courseId="b2a1" />);

    // 09:30 in Kolkata on the Monday the read landed, and the 11:30 class the student already
    // asked for — the same minute shape, one of them pressable and one of them not.
    await screen.findByRole('button', { name: 'Monday 28 Sept, 09:30 to 10:15' });
    expect(screen.queryByRole('button', { name: /11:30/ })).toBeNull();
    expect(screen.getByText('11:30–12:15')).toBeInTheDocument();
  });

  it('says whose clock the grid is read in', async () => {
    render(<BookAClass courseId="b2a1" />);

    await screen.findByText(/Times are the teacher's clock: Asia\/Kolkata \(GMT\+5:30\)/);
  });

  it('asks before it writes, and sends the minute the chip was cut from', async () => {
    const user = userEvent.setup();
    render(<BookAClass courseId="b2a1" />);

    await user.click(await screen.findByRole('button', { name: 'Monday 28 Sept, 09:30 to 10:15' }));

    await screen.findByText('You picked');
    expect(bookings.bookSlot).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Request this class' }));

    expect(bookings.bookSlot).toHaveBeenCalledWith('b2a1', MONDAY);
    await waitFor(() => expect(notify.success).toHaveBeenCalled());
    expect(screen.queryByText('You picked')).toBeNull();
  });

  it("keeps a minute the student took on the grid as their own", async () => {
    const user = userEvent.setup();
    // What the API answers to the press is the class it just held, so the grid can draw it
    // straight away instead of waiting for the next read.
    bookings.bookSlot.mockResolvedValue({
      ...held(),
      startsAt: MONDAY,
      endsAt: '2026-09-28T04:45:00.000Z',
    });
    render(<BookAClass courseId="b2a1" />);

    await user.click(await screen.findByRole('button', { name: 'Monday 28 Sept, 09:30 to 10:15' }));
    await user.click(screen.getByRole('button', { name: 'Request this class' }));

    // The list the API sent still contains that minute, and the merged booking wins over it: a
    // chip that vanished would look like the press had taken the class off the calendar.
    await screen.findByText('09:30–10:15');
    expect(screen.queryByRole('button', { name: 'Monday 28 Sept, 09:30 to 10:15' })).toBeNull();
    expect(bookings.openSlotsFor).toHaveBeenCalledTimes(1);

    // The offer counted two open classes; one of them is now this student's, so the line left
    // above the grid cannot still call it open.
    expect(screen.getByText(/1 open class/)).toBeInTheDocument();
  });

  it('names a trial call for a student with no place in the course', async () => {
    bookings.openSlotsFor.mockResolvedValue(offer({ entitlement: 'demo' }));
    render(<BookAClass courseId="b2a1" />);

    await screen.findByText(/this is a trial call/i);
  });

  it('shows the door rather than a grid to a student who may not book', async () => {
    bookings.openSlotsFor.mockResolvedValue(
      offer({ entitlement: 'none', denial: 'enrollment_required', slots: [] }),
    );
    const user = userEvent.setup();
    render(<BookAClass courseId="b2a1" />);

    await screen.findByText(/Classes are for students of the course/);
    expect(screen.queryByRole('button', { name: 'Monday 28 Sept, 09:30 to 10:15' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Go to the course' }));
    expect(push).toHaveBeenCalledWith('/courses/b2a1');
  });

  it('says so when the trial call is the door that shut', async () => {
    bookings.openSlotsFor.mockResolvedValue(
      offer({ entitlement: 'none', denial: 'demo_already_taken', slots: [] }),
    );
    render(<BookAClass courseId="b2a1" />);

    await screen.findByText(/One trial class per course/);
  });

  it('explains an offer with nothing in it', async () => {
    bookings.openSlotsFor.mockResolvedValue(offer({ slots: [] }));
    render(<BookAClass courseId="b2a1" />);

    await screen.findByText(/No class to take right now/);
  });

  it('pages the month the API searched and stops at its end', async () => {
    const user = userEvent.setup();
    render(<BookAClass courseId="b2a1" />);

    await screen.findByRole('button', { name: 'Monday 28 Sept, 09:30 to 10:15' });
    expect(screen.queryByRole('button', { name: 'Monday 5 Oct, 09:30 to 10:15' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await screen.findByRole('button', { name: 'Monday 5 Oct, 09:30 to 10:15' });

    // Five weeks of columns for a thirty-day horizon: the last one runs past the search and is
    // marked rather than offered, so the arrow stops there instead of paging into empty weeks.
    for (let week = 1; week < 4; week += 1) {
      await user.click(screen.getByRole('button', { name: 'Next week' }));
    }
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled();
  });

  it('reports a minute that went and reads the calendar again', async () => {
    const user = userEvent.setup();
    bookings.bookSlot.mockRejectedValueOnce(
      refused('CONFLICT', 'That class time is no longer free. Pick another one from the calendar.'),
    );
    render(<BookAClass courseId="b2a1" />);

    await user.click(await screen.findByRole('button', { name: 'Monday 28 Sept, 09:30 to 10:15' }));
    await user.click(screen.getByRole('button', { name: 'Request this class' }));

    await screen.findByText(/no longer free/);
    expect(notify.error).not.toHaveBeenCalled();
    await waitFor(() => expect(bookings.openSlotsFor).toHaveBeenCalledTimes(2));
  });

  it('keeps a refusal that is not about the minute on the chip it belongs to', async () => {
    const user = userEvent.setup();
    bookings.bookSlot.mockRejectedValueOnce(
      refused('VALIDATION_FAILED', 'This teacher does not keep a class open at that minute.'),
    );
    render(<BookAClass courseId="b2a1" />);

    await user.click(await screen.findByRole('button', { name: 'Monday 28 Sept, 09:30 to 10:15' }));
    await user.click(screen.getByRole('button', { name: 'Request this class' }));

    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    // Nothing about the page has changed, so the pick stays where it was made.
    expect(screen.getByText('You picked')).toBeInTheDocument();
    expect(bookings.openSlotsFor).toHaveBeenCalledTimes(1);
  });

  it('puts a calendar that never loaded where it can be retried', async () => {
    bookings.openSlotsFor.mockRejectedValueOnce(
      refused('NETWORK_ERROR', 'The API is unreachable.'),
    );
    const user = userEvent.setup();
    render(<BookAClass courseId="b2a1" />);

    await screen.findByText(/The teacher's calendar did not load/);
    await user.click(screen.getByRole('button', { name: /try again/i }));

    await screen.findByRole('button', { name: 'Monday 28 Sept, 09:30 to 10:15' });
    expect(bookings.openSlotsFor).toHaveBeenCalledTimes(2);
  });

  it("shows a pick in both clocks when the two disagree", async () => {
    session.value = { status: 'signed-in', user: { ...SAM, timezone: 'Europe/London' } };
    const user = userEvent.setup();
    render(<BookAClass courseId="b2a1" />);

    await user.click(await screen.findByRole('button', { name: 'Monday 28 Sept, 09:30 to 10:15' }));

    // The grid is Kolkata; this line is the student's own London, which is the clock that decides
    // whether they are awake for it.
    await screen.findByText(/Which is Mon, 28 Sept 2026 · 5:00 am GMT\+1 where you are\./);
  });
});
