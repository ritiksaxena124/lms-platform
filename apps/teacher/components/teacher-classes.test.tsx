import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingRequest } from '@lms/shared';
import { BOOKING_STATUS_CODES } from '@lms/shared';

import { ApiError } from '@/lib/api';

import { TeacherClasses } from './teacher-classes';

vi.mock('./session-provider', () => ({
  useSession: () => ({ status: 'signed-in', user: { fullName: 'Test', timezone: 'UTC' } }),
}));

vi.mock('@/lib/bookings', () => ({
  listClasses: vi.fn(),
}));

import { listClasses } from '@/lib/bookings';

/** The teacher's own schedule, read at a moment when nothing booked below has gone by yet. */
const NOW = new Date('2026-10-03T06:00:00.000Z');

function booked(overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    id: 'class-1',
    course: { id: 'course-1', slug: 'veena-basics', title: 'Veena Basics' },
    type: 'enrolled',
    status: BOOKING_STATUS_CODES.CONFIRMED,
    startsAt: '2026-10-05T09:30:00.000Z',
    endsAt: '2026-10-05T10:15:00.000Z',
    durationMinutes: 45,
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
    student: { id: 'student-1', displayName: 'Aria Kapoor' },
    ...overrides,
  };
}

/** A class that was taught two days before the teacher opened this screen. */
const WAS = {
  id: 'class-old',
  startsAt: '2026-10-01T09:30:00.000Z',
  endsAt: '2026-10-01T10:15:00.000Z',
};

const queue = () => vi.mocked(listClasses);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  queue().mockReset().mockResolvedValue([]);
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
    // A confirmed class whose hour has passed is history whatever its status says — nothing in
    // Phase 4 marks it taught, so the status would still read `confirmed` beside a date behind
    // the teacher. The split is made on the time for that reason, not on the answer.
    queue().mockResolvedValue([booked(WAS)]);
    render(<TeacherClasses />);

    expect(await screen.findByText('Earlier')).toBeInTheDocument();
    expect(within(section('Coming up')).queryByText('Aria Kapoor')).toBeNull();
    expect(within(section('Earlier')).getByText('Aria Kapoor')).toBeInTheDocument();
  });

  it('keeps the words the API gave a class that is over', async () => {
    queue().mockResolvedValue([
      booked({ status: BOOKING_STATUS_CODES.EXPIRED }),
      booked({
        id: 'class-2',
        status: BOOKING_STATUS_CODES.REJECTED,
        student: { id: 'student-2', displayName: 'Chen Yu' },
      }),
    ]);
    render(<TeacherClasses />);

    expect(await screen.findByText('Chen Yu')).toBeInTheDocument();
    expect(within(rowOf('Aria Kapoor')).getByText('Expired')).toBeInTheDocument();
    expect(within(rowOf('Chen Yu')).getByText('Declined')).toBeInTheDocument();
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
});
