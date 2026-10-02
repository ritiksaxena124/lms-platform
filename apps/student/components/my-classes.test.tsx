import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssignedClass, AuthUser, Booking } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { MyClasses } from './my-classes';

const bookings = vi.hoisted(() => ({
  myBookings: vi.fn(),
  leaveClass: vi.fn(),
  joinRoom: vi.fn(),
}));
const assignedClasses = vi.hoisted(() => ({ myAssignedClasses: vi.fn() }));
const session = vi.hoisted(() => ({
  value: { status: 'signed-in' as string, user: null as AuthUser | null },
}));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const push = vi.hoisted(() => vi.fn());

vi.mock('@/lib/bookings', () => bookings);
vi.mock('@/lib/cohort-classes', () => assignedClasses);
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

/** A class the course scheduled rather than one the student asked for: the same window shape, with
 * no status until a teacher marks it. */
const COHORT_ONE: AssignedClass = {
  id: 'o8',
  course: { id: 'b2a1', slug: 'fractions', title: 'Fractions, the slow way' },
  startsAt: MONDAY,
  endsAt: MONDAY_END,
  durationMinutes: 45,
  status: null,
};

function assigned(overrides: Partial<AssignedClass> = {}): AssignedClass {
  return { ...COHORT_ONE, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  session.value = { status: 'signed-in', user: SAM };
  bookings.myBookings.mockReset().mockResolvedValue([]);
  bookings.leaveClass.mockReset().mockResolvedValue(booking({ status: 'cancelled' }));
  assignedClasses.myAssignedClasses.mockReset().mockResolvedValue([]);
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

  /**
   * The 403 the shared cookie really produces: a sign-in earned at the teacher portal that this
   * student tab is holding. Retrying asks the same session the same question, so the honest answer
   * names the account that would work and points at the sign-in, exactly as `My courses` does —
   * the two screens read the same refusal and must not disagree about what it means.
   */
  it('names a session that is not a learner, and does not offer a retry of the same answer', async () => {
    bookings.myBookings.mockRejectedValueOnce(
      new ApiError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This account is not allowed to do that.',
      }),
    );

    render(<MyClasses />);

    await screen.findByText('This is not a learner account');
    expect(screen.queryByText(/not allowed to do that/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.getByRole('link', { name: /sign in as a learner/i })).toHaveAttribute(
      'href',
      '/login?next=%2Fmy-classes',
    );
  });

  it('sends a student with nothing booked to the shelf', async () => {
    const user = userEvent.setup();
    bookings.myBookings.mockResolvedValue([]);

    render(<MyClasses />);

    await screen.findByText(/No classes yet/);
    await user.click(screen.getByRole('button', { name: /browse the shelf/i }));
    expect(push).toHaveBeenCalledWith('/');
  });

  /**
   * The door on a class that is happening.
   *
   * The list says a door exists and when it opens; only the student's own press turns that into an
   * address. A Jitsi room's name is its whole lock, so the tests below care as much about the room
   * never becoming a link as about it appearing at all.
   */
  describe('the live class door', () => {
    const ROOM_URL = 'https://meet.jit.si/LMS-6a27-9f31';
    /** Inside the door's hours: 09:35 on Monday 28 Sept in Kolkata. */
    const WHILE_OPEN = '2026-09-28T04:05:00.000Z';

    function row(): HTMLElement {
      const link = screen.getByRole('link', { name: 'Fractions, the slow way' });
      const line = link.closest('li');
      if (!line) throw new Error('the class has no row');
      return line as HTMLElement;
    }

    beforeEach(() => {
      bookings.joinRoom.mockReset().mockResolvedValue(ROOM_URL);
    });

    it('says when the door opens rather than offering one that is shut', async () => {
      // The page was opened before the window; a Join button here could only ever be refused, and
      // the refusal would arrive as a surprise instead of as the sentence already on the row.
      bookings.myBookings.mockResolvedValue([booking()]);

      render(<MyClasses />);

      await screen.findByText('Fractions, the slow way');
      expect(screen.getByText('Door opens Mon 28 Sept, 09:25')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
      expect(bookings.joinRoom).not.toHaveBeenCalled();
    });

    it('offers the door once it stands open', async () => {
      vi.setSystemTime(new Date(WHILE_OPEN));
      bookings.myBookings.mockResolvedValue([booking()]);

      render(<MyClasses />);

      await screen.findByText('Fractions, the slow way');
      expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument();
    });

    it('stops offering a door the grace has gone past', async () => {
      // A quarter of an hour after the last minute. The class is in "Earlier" now, and the door
      // says so too rather than offering a room nobody is in.
      vi.setSystemTime(new Date('2026-09-28T05:30:00.000Z'));
      bookings.myBookings.mockResolvedValue([booking()]);

      render(<MyClasses />);

      await screen.findByText('Fractions, the slow way');
      expect(screen.getByText('Door closed')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    });

    it('draws no door at all on a class that has none', async () => {
      // A request the teacher has not answered has no room yet, and a called-off one never will.
      bookings.myBookings.mockResolvedValue([booking({ status: 'pending' })]);

      render(<MyClasses />);

      await screen.findByText('Fractions, the slow way');
      expect(row().textContent).not.toMatch(/door/i);
    });

    it('asks for the address when Join is pressed, and opens it in the page rather than linking to it', async () => {
      const user = userEvent.setup();
      vi.setSystemTime(new Date(WHILE_OPEN));
      bookings.myBookings.mockResolvedValue([booking()]);

      render(<MyClasses />);

      await user.click(await screen.findByRole('button', { name: 'Join' }));

      await waitFor(() => expect(bookings.joinRoom).toHaveBeenCalledWith('6a27'));
      const room = await waitFor(() => {
        const found = document.querySelector('iframe');
        if (!found) throw new Error('the room did not open');
        return found;
      });
      expect(room.getAttribute('src')).toBe(ROOM_URL);
      // An anchor would leave the address in history, in a status line on hover and in whatever a
      // prefetcher decides to fetch — three copies of a key that was meant to be used once.
      expect(document.querySelector(`a[href="${ROOM_URL}"]`)).toBeNull();
    });

    it('takes the address back off the page when the student leaves the room', async () => {
      const user = userEvent.setup();
      vi.setSystemTime(new Date(WHILE_OPEN));
      bookings.myBookings.mockResolvedValue([booking()]);

      render(<MyClasses />);

      await user.click(await screen.findByRole('button', { name: 'Join' }));
      await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());

      await user.click(screen.getByRole('button', { name: 'Leave the room' }));

      await waitFor(() => expect(document.querySelector('iframe')).toBeNull());
      expect(screen.queryByText(ROOM_URL)).toBeNull();
    });

    it('says the reason a door stayed shut, and puts no room on the page', async () => {
      const user = userEvent.setup();
      vi.setSystemTime(new Date(WHILE_OPEN));
      bookings.joinRoom.mockRejectedValue(
        refused('CONFLICT', 'This class is not standing, so there is no room to join.'),
      );
      bookings.myBookings.mockResolvedValue([booking()]);

      render(<MyClasses />);

      await user.click(await screen.findByRole('button', { name: 'Join' }));

      // The class may have been called off while this page sat open. The API's sentence is the one
      // worth reading, and a silent button would send the student to press it again.
      await waitFor(() =>
        expect(notify.error).toHaveBeenCalledWith(
          'This class is not standing, so there is no room to join.',
        ),
      );
      expect(document.querySelector('iframe')).toBeNull();
    });
  });

  /**
   * The classes a course scheduled rather than the ones this student asked for.
   *
   * A cohort class arrives from a second route and a second kind of decision — the teacher's plan,
   * not a booking — so the tests below care less that it appears than that it appears *on the same
   * calendar*, and that nothing on it offers a way out or a room, neither of which the platform has
   * for a class nobody booked.
   */
  describe('the classes a course scheduled', () => {
    /** 10:30–11:15 on the same Monday, in a course of its own. */
    function cohort(overrides: Partial<AssignedClass> = {}): AssignedClass {
      return assigned({
        course: { id: 'c2', slug: 'veena-basics', title: 'Veena Basics' },
        startsAt: '2026-09-28T05:00:00.000Z',
        endsAt: '2026-09-28T05:45:00.000Z',
        ...overrides,
      });
    }

    function rowOf(name: string): HTMLElement {
      const link = screen.getByRole('link', { name });
      const line = link.closest('li');
      if (!line) throw new Error(`${name} has no row`);
      return line as HTMLElement;
    }

    it('puts them on the same calendar, in the order they happen', async () => {
      bookings.myBookings.mockResolvedValue([booking()]);
      assignedClasses.myAssignedClasses.mockResolvedValue([cohort()]);

      render(<MyClasses />);

      const upcoming = await screen.findByLabelText('Coming up');
      expect(
        within(rowOf('Veena Basics')).getByText('Mon 28 Sept, 10:30–11:15'),
      ).toBeInTheDocument();
      const text = upcoming.textContent ?? '';
      expect(text.indexOf('09:30–10:15')).toBeLessThan(text.indexOf('10:30–11:15'));
      expect(screen.getByRole('link', { name: 'Veena Basics' })).toHaveAttribute(
        'href',
        '/courses/c2',
      );
    });

    it('counts both halves of the calendar in the line at the top', async () => {
      bookings.myBookings.mockResolvedValue([booking()]);
      assignedClasses.myAssignedClasses.mockResolvedValue([cohort()]);

      render(<MyClasses />);

      expect(await screen.findByText('2 classes on your calendar')).toBeInTheDocument();
    });

    it('names a scheduled class as one, and says nothing about a mark nobody has made', async () => {
      assignedClasses.myAssignedClasses.mockResolvedValue([cohort()]);

      render(<MyClasses />);

      await screen.findByText('Veena Basics');
      expect(rowOf('Veena Basics')).toHaveTextContent('Cohort class');
      // The attendance vocabulary is not this stage's, and an invented word on an unmarked row
      // would read as a mark the teacher never made.
      expect(within(rowOf('Veena Basics')).queryByText(/confirmed|pending|not marked/i)).toBeNull();
    });

    it('offers no way out of a class the series booked, and no room either', async () => {
      bookings.myBookings.mockResolvedValue([booking()]);
      assignedClasses.myAssignedClasses.mockResolvedValue([cohort()]);

      render(<MyClasses />);

      await screen.findByText('Veena Basics');
      // Leaving is a booking's story: nobody can quit a class their place in the course brought
      // them, and there is no route here that would accept the press.
      expect(screen.getAllByRole('button', { name: /leave this class/i })).toHaveLength(1);
      expect(rowOf('Fractions, the slow way')).toContainElement(
        screen.getByRole('button', { name: /leave this class/i }),
      );
      expect(rowOf('Veena Basics').textContent).not.toMatch(/door|join/i);
    });

    it('shows the calendar when the only class on it was scheduled', async () => {
      assignedClasses.myAssignedClasses.mockResolvedValue([cohort()]);

      render(<MyClasses />);

      expect(await screen.findByText('Veena Basics')).toBeInTheDocument();
      expect(screen.queryByText(/No classes yet/)).toBeNull();
    });

    it('reads both lists again when a class is left, because the calendar is one answer', async () => {
      const user = userEvent.setup();
      bookings.myBookings.mockResolvedValue([booking()]);
      assignedClasses.myAssignedClasses.mockResolvedValue([cohort()]);

      render(<MyClasses />);

      await user.click(await screen.findByRole('button', { name: /leave this class/i }));

      await waitFor(() => expect(bookings.myBookings).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(assignedClasses.myAssignedClasses).toHaveBeenCalledTimes(2));
    });

    it('puts a failed read of either list where it can be retried', async () => {
      bookings.myBookings.mockResolvedValue([booking()]);
      assignedClasses.myAssignedClasses.mockRejectedValueOnce(
        refused('NETWORK_ERROR', 'The API is unreachable.'),
      );

      render(<MyClasses />);

      expect(await screen.findByText('Your classes did not load')).toBeInTheDocument();
    });
  });
});

/** The readable text of one section's rows, so a test can say which half a class landed in. */
function withinList(section: HTMLElement): string {
  return section.textContent ?? '';
}
