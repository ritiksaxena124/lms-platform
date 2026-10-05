import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, Enrollment, EnrollmentPayment, PlaceResponse } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { EnrollControl } from './enroll-control';

const enrollments = vi.hoisted(() => ({
  myPlaces: vi.fn(),
  heldPlaces: vi.fn(),
  takePlace: vi.fn(),
  payForPlace: vi.fn(),
}));
const session = vi.hoisted(() => ({
  value: { status: 'signed-out' as string, user: null as AuthUser | null },
}));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/enrollments', () => enrollments);
vi.mock('./session-provider', () => ({ useSession: () => session.value }));
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

function place(courseId = 'b2a1'): Enrollment {
  return {
    id: 'e7f2',
    course: {
      id: courseId,
      slug: 'algebra-for-the-cbse-boards',
      title: 'Algebra for the CBSE boards',
    },
    isActive: true,
    enrolledAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
  };
}

/** A place whose money has not arrived. The row is closed and an attempt stands beside it —
 * which is the only thing that tells it apart from a place somebody left. */
function held(courseId = 'b2a1'): Enrollment {
  return { ...place(courseId), isActive: false };
}

const OWED: EnrollmentPayment = {
  id: 'p1c8',
  amountMinorUnits: 499900,
  currency: 'INR',
  status: 'pending',
  providerReference: null,
  error: null,
};

const PAID: EnrollmentPayment = { ...OWED, status: 'completed', providerReference: 'mock-p1c8' };

/** A course that cost nothing: the place opens and there is no receipt to show. */
function free(opened = place()): PlaceResponse {
  return { enrollment: opened, payment: null };
}

function signedIn() {
  session.value = { status: 'signed-in', user: SAM };
}

function signedOut() {
  session.value = { status: 'signed-out', user: null };
}

const refused = (code: string, statusCode: number, message: string) =>
  new ApiError({ statusCode, code, message });

beforeEach(() => {
  signedOut();
  // Reset, not just a new implementation: the call counts are what several of these tests
  // assert on, and a mock that carries a previous test's presses answers them wrongly. The
  // toast spies are reset for the same reason — half of what follows asks that nothing was said.
  enrollments.myPlaces.mockReset().mockResolvedValue([]);
  enrollments.heldPlaces.mockReset().mockResolvedValue([]);
  enrollments.takePlace.mockReset().mockResolvedValue(free());
  enrollments.payForPlace.mockReset().mockResolvedValue(free());
  notify.success.mockReset();
  notify.error.mockReset();
});

/**
 * The one decision this screen asks a visitor to make, and the three different answers it has
 * to give: a stranger is shown the door, a member outside this course is shown the button, and
 * a member already inside is shown nothing to press.
 */
describe('EnrollControl', () => {
  it('offers a stranger the way in rather than a button that cannot work', () => {
    render(<EnrollControl courseId="b2a1" />);

    // An enroll request without a session is a 401, and a button that would fail on the first
    // press is worse than a link that explains where the press has to be made.
    expect(screen.getByRole('link', { name: /sign in to enroll/i })).toHaveAttribute(
      'href',
      '/login?next=%2Fcourses%2Fb2a1',
    );
    expect(screen.queryByRole('button', { name: /enroll/i })).not.toBeInTheDocument();
  });

  it('does not ask for a roster nobody is signed in to read', () => {
    render(<EnrollControl courseId="b2a1" />);

    expect(enrollments.myPlaces).not.toHaveBeenCalled();
  });

  it('holds the space open while the session is still being checked', () => {
    session.value = { status: 'bootstrapping', user: null };
    render(<EnrollControl courseId="b2a1" />);

    // Neither the link nor the button: whichever it showed first would be wrong a moment later,
    // and a control that changes identity under a cursor is a control nobody trusts.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Checking whether you hold a place')).toBeInTheDocument();
  });

  it('says nothing at all when the session could not be checked', () => {
    session.value = { status: 'unreachable', user: null };
    render(<EnrollControl courseId="b2a1" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('gives a member outside the course the button, and the roster only to a member', async () => {
    signedIn();
    enrollments.myPlaces.mockResolvedValue([place('other-course')]);
    render(<EnrollControl courseId="b2a1" />);

    await screen.findByRole('button', { name: /enroll in this course/i });
    expect(enrollments.myPlaces).toHaveBeenCalledTimes(1);
  });

  it('tells a member already inside when they came, instead of asking them again', async () => {
    signedIn();
    enrollments.myPlaces.mockResolvedValue([place()]);
    render(<EnrollControl courseId="b2a1" />);

    await screen.findByText(/20 Sept 2026/i);
    expect(screen.queryByRole('button', { name: /enroll/i })).not.toBeInTheDocument();
    // The way to the rest of what they are inside, which is the thing an enrolled person
    // actually comes back for.
    expect(screen.getByRole('link', { name: /my courses/i })).toHaveAttribute(
      'href',
      '/my-courses',
    );
  });

  it('takes the place where the button was, in one press', async () => {
    signedIn();
    const onPlaceTaken = vi.fn();
    enrollments.myPlaces.mockResolvedValue([]);
    render(<EnrollControl courseId="b2a1" onPlaceTaken={onPlaceTaken} />);

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));

    await waitFor(() => expect(enrollments.takePlace).toHaveBeenCalledWith('b2a1'));
    expect(onPlaceTaken).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalled();
    // The rows above it open on the re-read this callback asks for, so the control must not
    // still be offering the thing that just happened.
    await screen.findByText(/20 Sept 2026/i);
    expect(screen.queryByRole('button', { name: /enroll/i })).not.toBeInTheDocument();
  });

  it('presses once, however many times the pointer tries', async () => {
    signedIn();
    enrollments.myPlaces.mockResolvedValue([]);
    let release: (value: PlaceResponse) => void = () => {};
    enrollments.takePlace.mockReturnValue(
      new Promise<PlaceResponse>((resolve) => {
        release = resolve;
      }),
    );
    render(<EnrollControl courseId="b2a1" />);

    const button = await screen.findByRole('button', { name: /enroll in this course/i });
    await userEvent.click(button);
    await userEvent.click(button);

    expect(enrollments.takePlace).toHaveBeenCalledTimes(1);
    release(free());
  });

  it('keeps the button where a course that closed refused it', async () => {
    signedIn();
    const onPlaceTaken = vi.fn();
    enrollments.myPlaces.mockResolvedValue([]);
    enrollments.takePlace.mockRejectedValueOnce(
      refused('NOT_FOUND', 404, 'We cannot find that course.'),
    );
    render(<EnrollControl courseId="b2a1" onPlaceTaken={onPlaceTaken} />);

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));

    // A place the API refused was not taken: the roster stays as it was, the outline is not
    // re-read, and the message says what failed rather than pretending otherwise.
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(onPlaceTaken).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /enroll in this course/i })).toBeInTheDocument();
  });

  it('still offers the button when the roster could not be read', async () => {
    signedIn();
    enrollments.myPlaces.mockRejectedValueOnce(
      refused('INTERNAL', 500, 'Something went wrong. Please try again.'),
    );
    render(<EnrollControl courseId="b2a1" />);

    // Enrolling twice is one place, so the write is safe without the read — and a screen that
    // hid the button because a list failed would lock a student out of a course they can join.
    const button = await screen.findByRole('button', { name: /enroll in this course/i });
    expect(button).toBeInTheDocument();
    expect(screen.getByText(/could not check/i)).toBeInTheDocument();
  });

  it('names the session when the place check says this account is not a learner', async () => {
    signedIn();
    enrollments.myPlaces.mockRejectedValueOnce(
      refused('FORBIDDEN', 403, 'This account is not allowed to do that.'),
    );
    render(<EnrollControl courseId="b2a1" />);

    // A 403 is not a connection that has not come back: the session is live and this is not the
    // account the portal can take a place with. Saying "we could not check" would send the
    // reader to press a button that can only answer 403 again.
    await screen.findByText(/not a learner account/i);
    expect(screen.queryByRole('button', { name: /enroll/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/have a coupon code/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in as a learner/i })).toHaveAttribute(
      'href',
      '/login?next=%2Fcourses%2Fb2a1',
    );
  });

  it('says the same thing when the write is refused for the wrong role', async () => {
    signedIn();
    enrollments.myPlaces.mockResolvedValue([]);
    enrollments.takePlace.mockRejectedValueOnce(
      refused('FORBIDDEN', 403, 'This account is not allowed to do that.'),
    );
    render(<EnrollControl courseId="b2a1" />);

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));

    // The API's line is true and useless: it does not say which account would work.
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(expect.stringMatching(/not a learner account/i)),
    );
    expect(notify.error).not.toHaveBeenCalledWith(expect.stringMatching(/not allowed to do that/i));
  });
});

/**
 * The step between asking for a place and getting one, on a course that costs something: the
 * press opens a hold rather than a door, and the money is the second press.
 */
describe('EnrollControl on a priced course', () => {
  it('offers the money rather than claiming a place that has not opened', async () => {
    signedIn();
    // The press answers a hold: a closed place with an attempt beside it, which is neither "in this
    // course" nor "not enrolled". The hold read finds nothing here, because this tab is the one that
    // created it and its own answer is the freshest copy of the row.
    enrollments.takePlace.mockResolvedValue({ enrollment: held(), payment: OWED });
    const onPlaceTaken = vi.fn();
    render(<EnrollControl courseId="b2a1" onPlaceTaken={onPlaceTaken} />);

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));

    expect(notify.success).not.toHaveBeenCalled();
    expect(screen.queryByText(/in this course since/i)).not.toBeInTheDocument();
    // The outline is still locked: `isReadable` is an answer about this reader, and this reader
    // has not been given the course yet.
    expect(onPlaceTaken).not.toHaveBeenCalled();

    const pay = await screen.findByRole('button', { name: /pay ₹4,999\.00/i });
    expect(pay).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /enroll in this course/i }),
    ).not.toBeInTheDocument();
  });

  it('opens the place the moment the charge comes back', async () => {
    signedIn();
    enrollments.takePlace.mockResolvedValue({ enrollment: held(), payment: OWED });
    enrollments.payForPlace.mockResolvedValue({ enrollment: place(), payment: PAID });
    const onPlaceTaken = vi.fn();
    render(<EnrollControl courseId="b2a1" onPlaceTaken={onPlaceTaken} />);

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));
    await userEvent.click(await screen.findByRole('button', { name: /pay ₹4,999\.00/i }));

    // The press is against the place, not the attempt: a student acts on the course they asked
    // for, and the API finds the newest attempt on it.
    await waitFor(() => expect(enrollments.payForPlace).toHaveBeenCalledWith('e7f2'));
    expect(onPlaceTaken).toHaveBeenCalled();
    await screen.findByText(/20 Sept 2026/i);
    expect(screen.queryByRole('button', { name: /pay /i })).not.toBeInTheDocument();
  });

  it('says why the charge was refused and asks for the same amount again', async () => {
    signedIn();
    enrollments.takePlace.mockResolvedValue({ enrollment: held(), payment: OWED });
    enrollments.payForPlace.mockResolvedValue({
      enrollment: held(),
      payment: { ...OWED, status: 'failed', error: 'The card was declined.' },
    });
    const onPlaceTaken = vi.fn();
    render(<EnrollControl courseId="b2a1" onPlaceTaken={onPlaceTaken} />);

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));
    await userEvent.click(await screen.findByRole('button', { name: /pay ₹4,999\.00/i }));

    // A refusal is `200` with the attempt marked `failed`: the place moved into a state, and the
    // reason the ledger holds is the only thing the reader can act on. The door did not open, so
    // nothing above it is re-read and nothing is claimed about it.
    await screen.findByText(/The card was declined\./i);
    expect(notify.success).not.toHaveBeenCalled();
    expect(onPlaceTaken).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /pay ₹4,999\.00/i })).toBeInTheDocument();
  });

  it('leaves the money standing when the pay press never gets an answer', async () => {
    signedIn();
    enrollments.takePlace.mockResolvedValue({ enrollment: held(), payment: OWED });
    enrollments.payForPlace.mockRejectedValueOnce(
      refused('SERVICE_UNAVAILABLE', 503, 'This platform is not wired to take a payment.'),
    );
    render(<EnrollControl courseId="b2a1" />);

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));
    await userEvent.click(await screen.findByRole('button', { name: /pay ₹4,999\.00/i }));

    // The hold is still there and nothing about it changed, so the button that could settle it
    // has to stay exactly where it was.
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /pay ₹4,999\.00/i })).toBeInTheDocument();
  });
});

/**
 * The hold that outlives the tab that made it.
 *
 * A student who pressed Enroll on a priced course and then reloaded came back to a page that did not
 * know them: `GET /enrollments` lists places that are open, and a place waiting on money is not one,
 * so the only way to see the amount again was to press Enroll and hope. These tests are the second
 * read — the one that finds the hold on arrival — and the line the screen draws when it cannot be
 * heard at all.
 */
describe('EnrollControl finds a hold on arrival', () => {
  it('shows the money for a hold this tab did not press', async () => {
    signedIn();
    enrollments.myPlaces.mockResolvedValue([]);
    enrollments.heldPlaces.mockResolvedValue([{ enrollment: held(), payment: OWED }]);
    const onPlaceTaken = vi.fn();
    render(<EnrollControl courseId="b2a1" onPlaceTaken={onPlaceTaken} />);

    const pay = await screen.findByRole('button', { name: /pay ₹4,999\.00/i });
    expect(pay).toBeInTheDocument();
    expect(enrollments.heldPlaces).toHaveBeenCalledTimes(1);
    // Neither of the two lies this screen can tell: that the place is open, or that nothing was
    // ever asked for.
    expect(
      screen.queryByRole('button', { name: /enroll in this course/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/in this course since/i)).not.toBeInTheDocument();
    expect(notify.success).not.toHaveBeenCalled();
    expect(onPlaceTaken).not.toHaveBeenCalled();
  });

  it('prints the reason a standing attempt was refused, without a press to earn it', async () => {
    signedIn();
    enrollments.heldPlaces.mockResolvedValue([
      {
        enrollment: held(),
        payment: { ...OWED, status: 'failed', error: 'The card was declined.' },
      },
    ]);
    render(<EnrollControl courseId="b2a1" />);

    // The ledger already holds the line, so a reload says it rather than showing a bare button and
    // letting the student find out the same way twice.
    await screen.findByText(/The card was declined\./i);
    expect(screen.getByRole('button', { name: /pay ₹4,999\.00/i })).toBeInTheDocument();
  });

  it('will not offer the money for a hold in another course', async () => {
    signedIn();
    enrollments.heldPlaces.mockResolvedValue([{ enrollment: held('c9other'), payment: OWED }]);
    render(<EnrollControl courseId="b2a1" />);

    // The hold is real and belongs to this student — just not to this page.
    await screen.findByRole('button', { name: /enroll in this course/i });
    expect(screen.queryByRole('button', { name: /pay /i })).not.toBeInTheDocument();
  });

  it('keeps the button when the hold cannot be read', async () => {
    signedIn();
    enrollments.heldPlaces.mockRejectedValueOnce(
      refused('INTERNAL', 500, 'Something went wrong. Please try again.'),
    );
    render(<EnrollControl courseId="b2a1" />);

    // Nothing is lost by the failure, only the shortcut: a press answers the standing attempt with
    // itself, same id and same amount, so the worst this screen can do is make the student ask twice.
    const button = await screen.findByRole('button', { name: /enroll in this course/i });
    expect(button).toBeInTheDocument();
    expect(screen.getByText(/could not check/i)).toBeInTheDocument();
  });

  it('does not ask for a hold nobody is signed in to read', () => {
    signedOut();
    render(<EnrollControl courseId="b2a1" />);

    expect(enrollments.heldPlaces).not.toHaveBeenCalled();
  });
});
