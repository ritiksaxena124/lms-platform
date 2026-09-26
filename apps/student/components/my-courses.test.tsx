import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, Enrollment } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { MyCourses } from './my-courses';

const roster = vi.hoisted(() => ({ myPlaces: vi.fn(), leavePlace: vi.fn() }));
const push = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const session = vi.hoisted(() => ({
  value: { status: 'signed-in' as string, user: null as AuthUser | null },
}));

vi.mock('@/lib/enrollments', () => roster);
vi.mock('./session-provider', () => ({ useSession: () => session.value }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

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

function place(overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: 'e7f2',
    course: {
      id: 'b2a1',
      slug: 'algebra-for-the-cbse-boards',
      title: 'Algebra for the CBSE boards',
    },
    isActive: true,
    // 20:00 UTC on the 20th is the 21st in Kolkata, which is the day Sam remembers taking it.
    enrolledAt: '2026-09-20T20:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

const refused = (statusCode: number, code: string, message: string) =>
  new ApiError({ statusCode, code, message });

beforeEach(() => {
  session.value = { status: 'signed-in', user: SAM };
  roster.myPlaces.mockReset().mockResolvedValue([place()]);
  roster.leavePlace.mockReset().mockResolvedValue(place({ isActive: false }));
  push.mockReset();
  notify.success.mockReset();
  notify.error.mockReset();
});

/**
 * The shelf a student has already joined.
 *
 * Everything on this screen came from `GET /enrollments`, which the API already filters to
 * places that are open in courses still on the shelf — so a row here is a link that works, and
 * the screen adds no filter of its own to be wrong about.
 */
describe('MyCourses', () => {
  it('lists each place as the course it is in', async () => {
    render(<MyCourses />);

    const link = await screen.findByRole('link', { name: /Algebra for the CBSE boards/i });
    expect(link).toHaveAttribute('href', '/courses/b2a1');
    // The id, not the slug: this is the same pair of fields the roster was built with, and the
    // catalog accepts either but only one of them survives a teacher renaming the url.
  });

  it('says when the place was taken, on the student’s own calendar', async () => {
    render(<MyCourses />);

    expect(await screen.findByText(/21 Sept 2026/i)).toBeInTheDocument();
  });

  it('keeps the promise that one press of a button is one leave', async () => {
    render(<MyCourses />);

    await userEvent.click(await screen.findByRole('button', { name: /leave Algebra/i }));

    await waitFor(() => expect(roster.leavePlace).toHaveBeenCalledWith('e7f2'));
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: /Algebra for the CBSE boards/i }),
      ).not.toBeInTheDocument(),
    );
    expect(notify.success).toHaveBeenCalled();
  });

  it('holds the row when the API refused to close the place', async () => {
    roster.leavePlace.mockRejectedValueOnce(refused(500, 'INTERNAL', 'Try again shortly.'));
    render(<MyCourses />);

    await userEvent.click(await screen.findByRole('button', { name: /leave Algebra/i }));

    // A leave that did not happen has not taken anything away: the pages the student can read
    // are still theirs, and a row that vanished on a failure would say otherwise.
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: /Algebra for the CBSE boards/i })).toBeInTheDocument();
  });

  it('shows the shelf to somebody with nothing on it', async () => {
    roster.myPlaces.mockResolvedValue([]);
    render(<MyCourses />);

    await screen.findByText(/nothing you are inside/i);
    await userEvent.click(screen.getByRole('button', { name: /browse the shelf/i }));
    expect(push).toHaveBeenCalledWith('/');
  });

  it('offers a retry when the roster did not arrive, rather than an empty shelf', async () => {
    roster.myPlaces
      .mockRejectedValueOnce(refused(500, 'INTERNAL', 'Try again shortly.'))
      .mockResolvedValue([place()]);
    render(<MyCourses />);

    const heading = await screen.findByRole('heading', { name: /did not load/i });
    expect(heading).toBeInTheDocument();
    // "You have no courses" and "we could not ask" are different facts, and the first one sent
    // somebody to the shelf for nothing.
    expect(screen.queryByText(/nothing you are inside/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await screen.findByRole('link', { name: /Algebra for the CBSE boards/i });
  });

  it('says what it is doing while the list is coming', () => {
    roster.myPlaces.mockReturnValue(new Promise<Enrollment[]>(() => {}));
    render(<MyCourses />);

    expect(screen.getByText(/loading your courses/i)).toBeInTheDocument();
  });
});
