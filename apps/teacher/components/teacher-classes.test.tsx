import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingRequest, BookingStatusCode } from '@lms/shared';
import { BOOKING_STATUS_CODES } from '@lms/shared';

import { ApiError } from '@/lib/api';

import { TeacherClasses } from './teacher-classes';

vi.mock('./session-provider', () => ({
  useSession: () => ({ status: 'signed-in', user: { fullName: 'Test', timezone: 'UTC' } }),
}));

vi.mock('@/lib/bookings', () => ({
  listClasses: vi.fn(),
  joinRoom: vi.fn(),
  markClass: vi.fn(),
}));

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

import { joinRoom, listClasses, markClass } from '@/lib/bookings';

/** The teacher's own schedule, read at a moment when nothing booked below has gone by yet. */
const NOW = new Date('2026-10-03T06:00:00.000Z');

/** A class as the API sends it. The door is the window the room opens in — five minutes before
 * the first minute, a quarter of an hour after the last — and a row carries it because it is
 * confirmed and for no other reason. */
const CLASS_ONE: BookingRequest = {
  id: 'class-1',
  course: { id: 'course-1', slug: 'veena-basics', title: 'Veena Basics' },
  type: 'enrolled',
  status: BOOKING_STATUS_CODES.CONFIRMED,
  live: {
    opensAt: '2026-10-05T09:25:00.000Z',
    closesAt: '2026-10-05T10:30:00.000Z',
  },
  startsAt: '2026-10-05T09:30:00.000Z',
  endsAt: '2026-10-05T10:15:00.000Z',
  durationMinutes: 45,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
  student: { id: 'student-1', displayName: 'Aria Kapoor' },
};

/** The tests below move a class off `confirmed`, and a fixture that kept the door then would be a
 * shape no response has ever sent. */
function booked(overrides: Partial<BookingRequest> = {}): BookingRequest {
  const row = { ...CLASS_ONE, ...overrides };
  return row.status === BOOKING_STATUS_CODES.CONFIRMED ? row : { ...row, live: null };
}

/** A class that was taught two days before the teacher opened this screen. */
const WAS = {
  id: 'class-old',
  startsAt: '2026-10-01T09:30:00.000Z',
  endsAt: '2026-10-01T10:15:00.000Z',
};

/** A confirmed class two days gone, door window and all. The window travels with the status rather
 * than with the clock, so the row still carries it and the screen still says the door is shut. This
 * is the shape that used to sit on the schedule forever, reading `Confirmed` long after the hour it
 * names had gone by — the mark door is what finishes the sentence. */
const AND_GONE = {
  ...WAS,
  live: { opensAt: '2026-10-01T09:25:00.000Z', closesAt: '2026-10-01T10:30:00.000Z' },
};

const queue = () => vi.mocked(listClasses);

/** The address the join endpoint hands out for `CLASS_ONE`. It exists only in the answer. */
const ROOM_URL = 'https://meet.localtest.me/veena-0f2c9a';

/** Inside the door's hours: 09:25–10:30 on 5 Oct, and the class itself is 09:30–10:15. */
const WHILE_OPEN = new Date('2026-10-05T09:40:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  queue().mockReset().mockResolvedValue([]);
  vi.mocked(joinRoom).mockReset().mockResolvedValue(ROOM_URL);
  vi.mocked(markClass)
    .mockReset()
    .mockImplementation(async (id, status) =>
      booked({ ...AND_GONE, id, status: status as BookingStatusCode }),
    );
});

afterEach(() => {
  vi.useRealTimers();
});

function section(heading: string): HTMLElement {
  const found = screen.getByText(heading).closest('section');
  if (!found) throw new Error(`${heading} is not inside a section`);
  return found;
}

function rowOf(name: string): HTMLElement {
  const found = screen.getByText(name).closest('li');
  if (!found) throw new Error(`${name} is not inside a row`);
  return found;
}

describe('TeacherClasses', () => {
  it('shows each class with who it is with, what it is for and when it runs', async () => {
    queue().mockResolvedValue([booked()]);
    render(<TeacherClasses />);

    await screen.findByText('Aria Kapoor');
    const row = rowOf('Aria Kapoor');
    expect(within(row).getByText('Veena Basics')).toBeInTheDocument();
    expect(within(row).getByText('Mon 5 Oct, 09:30–10:15')).toBeInTheDocument();
    expect(within(row).getByText('Confirmed')).toBeInTheDocument();
  });

  it('says whose clock the windows are written on', async () => {
    queue().mockResolvedValue([booked()]);
    render(<TeacherClasses />);

    expect(await screen.findByText(/your clock, UTC/)).toBeInTheDocument();
  });

  it('does not keep a class that has gone by under Coming up', async () => {
    // A confirmed class whose hour has passed is history whatever its status says, because
    // nothing in Phase 4 marks a class taught. The date decides which half a row is in; the pill
    // only says what the row is.
    queue().mockResolvedValue([booked(WAS)]);
    render(<TeacherClasses />);

    expect(await screen.findByText('Earlier')).toBeInTheDocument();
    expect(within(section('Coming up')).queryByText('Aria Kapoor')).toBeNull();
    expect(within(section('Earlier')).getByText('Aria Kapoor')).toBeInTheDocument();
  });

  it('leaves a class you said no to in the week it was booked for', async () => {
    // The alternative is a refused request vanishing into "Earlier" while its date is still ahead
    // — which is where a teacher goes looking for it, because that minute is the reason they
    // declined it. The date holds the row in place and the word says what happened.
    queue().mockResolvedValue([booked({ status: BOOKING_STATUS_CODES.REJECTED })]);
    render(<TeacherClasses />);

    await screen.findByText('Aria Kapoor');
    expect(within(section('Coming up')).getByText('Declined')).toBeInTheDocument();
    expect(screen.queryByText('Earlier')).toBeNull();
  });

  it('keeps the words the API gave a class that is over', async () => {
    queue().mockResolvedValue([
      booked({ ...WAS, status: BOOKING_STATUS_CODES.EXPIRED }),
      booked({
        id: 'class-2',
        status: BOOKING_STATUS_CODES.REJECTED,
        startsAt: '2026-10-01T11:00:00.000Z',
        endsAt: '2026-10-01T11:45:00.000Z',
        student: { id: 'student-2', displayName: 'Chen Yu' },
      }),
    ]);
    render(<TeacherClasses />);

    expect(await screen.findByText('Chen Yu')).toBeInTheDocument();
    expect(within(section('Earlier')).getByText('Expired')).toBeInTheDocument();
    expect(within(section('Earlier')).getByText('Declined')).toBeInTheDocument();
  });

  it('names a trial class as one, in the schedule as much as in the queue', async () => {
    queue().mockResolvedValue([booked({ type: 'demo' })]);
    render(<TeacherClasses />);

    await screen.findByText('Aria Kapoor');
    const row = rowOf('Aria Kapoor');
    expect(within(row).getByText('Trial call')).toBeInTheDocument();
    expect(within(row).getByText('Confirmed')).toBeInTheDocument();
  });

  it('keeps a class the teacher has not answered on the schedule, and says so', async () => {
    // A request holds the minute whether or not it has an answer, so it belongs in "Coming up" —
    // but a teacher planning the week has to be able to tell the two apart at a glance, which is
    // what the word on the pill is for.
    queue().mockResolvedValue([
      booked({ status: BOOKING_STATUS_CODES.PENDING }),
      booked({ id: 'class-2', student: { id: 'student-2', displayName: 'Chen Yu' } }),
    ]);
    render(<TeacherClasses />);

    await screen.findByText('Chen Yu');
    expect(within(rowOf('Aria Kapoor')).getByText('Pending')).toBeInTheDocument();
    expect(within(rowOf('Chen Yu')).getByText('Confirmed')).toBeInTheDocument();
  });

  it('fails as a schedule, not as an empty one, when the read does not come back', async () => {
    queue().mockRejectedValue(new ApiError({ statusCode: 500, code: 'INTERNAL', message: 'down' }));
    render(<TeacherClasses />);

    expect(await screen.findByText('Your classes did not load')).toBeInTheDocument();
    expect(screen.queryByText('No classes booked yet')).toBeNull();
  });

  it('points at the requests queue, which is where an unanswered class still is', async () => {
    render(<TeacherClasses />);

    expect(await screen.findByText('No classes booked yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the requests' })).toHaveAttribute(
      'href',
      '/requests',
    );
  });

  it('says when the door opens, rather than offering one that is shut', async () => {
    // The screen was opened two days early. A Join button here would only ever be refused, and
    // the API's reason would arrive as a surprise rather than as the sentence on the row.
    queue().mockResolvedValue([booked()]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    expect(
      within(rowOf('Aria Kapoor')).getByText('Door opens Mon 5 Oct, 09:25'),
    ).toBeInTheDocument();
    expect(within(rowOf('Aria Kapoor')).queryByRole('button', { name: 'Join' })).toBeNull();
  });

  it('offers the door once it stands open', async () => {
    vi.setSystemTime(WHILE_OPEN);
    queue().mockResolvedValue([booked()]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    expect(within(rowOf('Aria Kapoor')).getByRole('button', { name: 'Join' })).toBeInTheDocument();
  });

  it('stops offering a door the grace has gone past', async () => {
    vi.setSystemTime(new Date('2026-10-05T11:00:00.000Z'));
    queue().mockResolvedValue([booked()]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    const row = rowOf('Aria Kapoor');
    expect(within(row).getByText('Door closed')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Join' })).toBeNull();
  });

  it('draws no door at all on a class that has none', async () => {
    // A pending request has no room yet, and a declined one never will. The list carries `live:
    // null` for exactly that, and the row has nothing to say about a door that does not exist.
    queue().mockResolvedValue([booked({ status: BOOKING_STATUS_CODES.PENDING })]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    expect(within(rowOf('Aria Kapoor')).queryByText(/door/i)).toBeNull();
  });

  it('asks for the address when Join is pressed, and opens it in the page rather than linking to it', async () => {
    vi.setSystemTime(WHILE_OPEN);
    queue().mockResolvedValue([booked()]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    await userEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(joinRoom).toHaveBeenCalledWith('class-1'));
    const room = await waitFor(() => {
      const found = document.querySelector('iframe');
      if (!found) throw new Error('the room did not open');
      return found;
    });
    expect(room.getAttribute('src')).toBe(ROOM_URL);
    // Not a link, not an anchor a browser can keep in history or hand to a prefetch.
    expect(document.querySelector(`a[href="${ROOM_URL}"]`)).toBeNull();
  });

  it('takes the address back off the page when the teacher leaves the room', async () => {
    vi.setSystemTime(WHILE_OPEN);
    queue().mockResolvedValue([booked()]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));

    await waitFor(() => expect(document.querySelector('iframe')).toBeNull());
    expect(screen.queryByText(ROOM_URL)).toBeNull();
  });

  it('says the reason a door stayed shut, and puts no room on the page', async () => {
    vi.setSystemTime(WHILE_OPEN);
    vi.mocked(joinRoom).mockRejectedValue(
      new ApiError({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'This class is not standing, so there is no room to join.',
      }),
    );
    queue().mockResolvedValue([booked()]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    await userEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'This class is not standing, so there is no room to join.',
      ),
    );
    expect(document.querySelector('iframe')).toBeNull();
  });

  /**
   * The two words that end a class.
   *
   * The screen offers them on one shape and one shape only: a confirmed class whose first minute
   * has arrived. Every other row already says how it ended — a request has not been answered, a
   * refusal and an expiry and a cancellation each name themselves — and a class that carries a mark
   * has been said. The gate here is courtesy, not the rule: the route refuses the same presses
   * again, and a row that went stale while the page stood open is corrected by the re-read.
   */
  it('offers the two words on a class whose hour has gone by', async () => {
    queue().mockResolvedValue([booked(AND_GONE)]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    const row = rowOf('Aria Kapoor');
    expect(within(row).getByRole('button', { name: 'Mark taught' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Mark missed' })).toBeInTheDocument();
  });

  it('offers neither word on a class that has not happened yet', async () => {
    // A mark is a report about an event. Filed before the event it is a prediction, and the API has
    // no door for one either.
    queue().mockResolvedValue([booked()]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    expect(within(rowOf('Aria Kapoor')).queryByRole('button', { name: /mark/i })).toBeNull();
  });

  it('offers neither word on a class that never stood', async () => {
    // Two days gone, and each of these already says what became of it. `no_show` over a request the
    // teacher never answered would report a class that never happened as one a student missed.
    for (const status of [
      BOOKING_STATUS_CODES.PENDING,
      BOOKING_STATUS_CODES.EXPIRED,
      BOOKING_STATUS_CODES.CANCELLED,
    ]) {
      queue().mockResolvedValue([booked({ ...AND_GONE, status })]);
      const { unmount } = render(<TeacherClasses />);
      await screen.findByText('Aria Kapoor');

      expect(within(rowOf('Aria Kapoor')).queryByRole('button', { name: /mark/i })).toBeNull();
      unmount();
    }
  });

  it('offers neither word twice, on a class that has one', async () => {
    queue().mockResolvedValue([
      booked({ ...AND_GONE, status: BOOKING_STATUS_CODES.COMPLETED }),
      booked({
        ...AND_GONE,
        id: 'class-old-2',
        status: BOOKING_STATUS_CODES.NO_SHOW,
        student: { id: 'student-2', displayName: 'Chen Yu' },
      }),
    ]);
    render(<TeacherClasses />);
    await screen.findByText('Chen Yu');

    expect(within(rowOf('Aria Kapoor')).queryByRole('button', { name: /mark/i })).toBeNull();
    expect(within(rowOf('Chen Yu')).queryByRole('button', { name: /mark/i })).toBeNull();
    // The word the API gave is the word the row wears, in the shared vocabulary the student's list
    // reads from as well.
    expect(within(rowOf('Aria Kapoor')).getByText('Completed')).toBeInTheDocument();
    expect(within(rowOf('Chen Yu')).getByText('No show')).toBeInTheDocument();
  });

  it('marks a class taught, and re-reads so the word on the row is the API’s', async () => {
    // The list is fetched again rather than the pressed word spliced into it: what the row says
    // after the press is what the table answered, not what the button was labelled.
    queue().mockResolvedValueOnce([booked(AND_GONE)]).mockResolvedValueOnce([
      booked({ ...AND_GONE, status: BOOKING_STATUS_CODES.COMPLETED }),
    ]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    await userEvent.click(screen.getByRole('button', { name: 'Mark taught' }));

    await waitFor(() => expect(markClass).toHaveBeenCalledWith('class-old', 'completed'));
    await waitFor(() => expect(queue()).toHaveBeenCalledTimes(2));
    expect(within(section('Earlier')).getByText('Completed')).toBeInTheDocument();
    expect(within(rowOf('Aria Kapoor')).queryByRole('button', { name: /mark/i })).toBeNull();
  });

  it('marks a class the student never came to as missed', async () => {
    queue().mockResolvedValue([booked(AND_GONE)]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    await userEvent.click(screen.getByRole('button', { name: 'Mark missed' }));

    await waitFor(() => expect(markClass).toHaveBeenCalledWith('class-old', 'no_show'));
  });

  it('says the reason a mark was refused, and re-reads the schedule rather than the word', async () => {
    // A 409 here means the class was not what the row on screen said it was — cancelled, or marked
    // from another tab. The API's sentence is the one worth reading, and the re-read is what makes
    // the row tell the truth afterwards.
    vi.mocked(markClass).mockRejectedValue(
      new ApiError({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'This class has already been marked off, so it cannot be marked a second way.',
      }),
    );
    queue().mockResolvedValue([booked(AND_GONE)]);
    render(<TeacherClasses />);
    await screen.findByText('Aria Kapoor');

    await userEvent.click(screen.getByRole('button', { name: 'Mark taught' }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'This class has already been marked off, so it cannot be marked a second way.',
      ),
    );
    await waitFor(() => expect(queue()).toHaveBeenCalledTimes(2));
    expect(within(rowOf('Aria Kapoor')).getByText('Confirmed')).toBeInTheDocument();
  });
});
