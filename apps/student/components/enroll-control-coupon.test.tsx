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

function place(isActive = true): Enrollment {
  return {
    id: 'e7f2',
    course: {
      id: 'b2a1',
      slug: 'algebra-for-the-cbse-boards',
      title: 'Algebra for the CBSE boards',
    },
    isActive,
    enrolledAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
  };
}

/** What a code that reaches zero answers with: the place is open and the ledger row beside it is
 * a completed charge of nothing, so the screen has a receipt and no debt. */
const SETTLED_AT_NOTHING: EnrollmentPayment = {
  id: 'p1c8',
  amountMinorUnits: 0,
  currency: 'INR',
  status: 'completed',
  providerReference: null,
  error: null,
};

function signedIn() {
  session.value = { status: 'signed-in', user: SAM };
}

beforeEach(() => {
  signedIn();
  enrollments.myPlaces.mockReset().mockResolvedValue([]);
  enrollments.heldPlaces.mockReset().mockResolvedValue([]);
  enrollments.takePlace
    .mockReset()
    .mockResolvedValue({ enrollment: place(), payment: null } satisfies PlaceResponse);
  enrollments.payForPlace.mockReset();
  notify.success.mockReset();
  notify.error.mockReset();
});

/**
 * The optional field beside the one ask: a code changes what a place costs, and on a priced
 * course it changes what the next press is for.
 */
describe('EnrollControl with coupon', () => {
  it('offers the code field to a member standing outside the course', async () => {
    render(<EnrollControl courseId="b2a1" />);

    await screen.findByRole('button', { name: /enroll in this course/i });
    expect(await screen.findByLabelText(/have a coupon code/i)).toBeInTheDocument();
  });

  it('keeps the field off a page a stranger cannot act on', () => {
    session.value = { status: 'signed-out', user: null };
    render(<EnrollControl courseId="b2a1" />);

    expect(screen.queryByLabelText(/have a coupon code/i)).not.toBeInTheDocument();
  });

  it('keeps the field off a member who is already inside', async () => {
    enrollments.myPlaces.mockResolvedValue([place()]);
    render(<EnrollControl courseId="b2a1" />);

    await screen.findByText(/20 Sept 2026/i);
    expect(screen.queryByLabelText(/have a coupon code/i)).not.toBeInTheDocument();
  });

  it('sends the code as it was written, in the case the API files it in', async () => {
    render(<EnrollControl courseId="b2a1" />);

    await userEvent.type(await screen.findByLabelText(/have a coupon code/i), 'cut20');
    await userEvent.click(screen.getByRole('button', { name: /enroll in this course/i }));

    // The field upper-cases while it is typed, so what the reader sees is what goes on the wire:
    // the lookup is exact, and a lower-case code would read as one that does not exist.
    await waitFor(() => expect(enrollments.takePlace).toHaveBeenCalledWith('b2a1', 'CUT20'));
  });

  it('enrolls with no code at all, because the field is never required', async () => {
    render(<EnrollControl courseId="b2a1" />);

    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));

    await waitFor(() => expect(enrollments.takePlace).toHaveBeenCalledWith('b2a1'));
    expect(enrollments.takePlace).not.toHaveBeenCalledWith('b2a1', '');
  });

  it('names the code that failed and leaves the ask standing', async () => {
    enrollments.takePlace.mockRejectedValueOnce(
      new ApiError({ statusCode: 400, code: 'VALIDATION_FAILED', message: 'Coupon not found' }),
    );
    render(<EnrollControl courseId="b2a1" />);

    await userEvent.type(await screen.findByLabelText(/have a coupon code/i), 'NOPE');
    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));

    // A refusal prices nothing and takes nothing, so the only honest screen is the same ask with
    // the API's own line under it.
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(expect.stringMatching(/coupon not found/i)),
    );
    expect(notify.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /enroll in this course/i })).toBeInTheDocument();
  });

  it('opens the course when the code reaches zero, and asks for no money', async () => {
    enrollments.takePlace.mockResolvedValue({
      enrollment: place(),
      payment: SETTLED_AT_NOTHING,
    });
    const onPlaceTaken = vi.fn();
    render(<EnrollControl courseId="b2a1" onPlaceTaken={onPlaceTaken} />);

    await userEvent.type(await screen.findByLabelText(/have a coupon code/i), 'FREE');
    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));

    // A completed charge of nothing is a receipt, not a debt: the pay step belongs to a place
    // that is still shut, and this one has opened.
    await screen.findByText(/20 Sept 2026/i);
    expect(screen.queryByRole('button', { name: /pay /i })).not.toBeInTheDocument();
    expect(notify.success).toHaveBeenCalled();
    expect(onPlaceTaken).toHaveBeenCalled();
  });

  it('prints the discounted figure on the pay step, not the price on the shelf', async () => {
    enrollments.takePlace.mockResolvedValue({
      enrollment: place(false),
      payment: { ...SETTLED_AT_NOTHING, amountMinorUnits: 249950, status: 'pending' },
    });
    render(<EnrollControl courseId="b2a1" />);

    await userEvent.type(await screen.findByLabelText(/have a coupon code/i), 'HALF');
    await userEvent.click(await screen.findByRole('button', { name: /enroll in this course/i }));

    // The amount the student owes is what this platform wrote on its own ledger row after the
    // code was applied — so a screen that printed the shelf price would ask for money the
    // coupon had already taken off.
    await screen.findByRole('button', { name: /pay ₹2,499\.50/i });
    expect(screen.queryByLabelText(/have a coupon code/i)).not.toBeInTheDocument();
  });

  it('still prints the discounted figure after a reload', async () => {
    enrollments.heldPlaces.mockResolvedValue([
      {
        enrollment: place(false),
        payment: { ...SETTLED_AT_NOTHING, amountMinorUnits: 249950, status: 'pending' },
      },
    ]);
    render(<EnrollControl courseId="b2a1" />);

    // The code is spent and the arithmetic is on the ledger row, so the hold read alone carries the
    // price the student was quoted. A reload that fell back to the shelf would ask for money the
    // coupon had already taken off.
    await screen.findByRole('button', { name: /pay ₹2,499\.50/i });
    expect(screen.queryByLabelText(/have a coupon code/i)).not.toBeInTheDocument();
  });
});
