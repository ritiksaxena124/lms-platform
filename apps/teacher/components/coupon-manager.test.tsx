import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Coupon, Course } from '@lms/shared';

import { CouponManager } from './coupon-manager';

const api = vi.hoisted(() => ({
  listCoupons: vi.fn(),
  createCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  deactivateCoupon: vi.fn(),
}));

vi.mock('@/lib/coupons', () => api);

// A fixed discount is a number of the course's own price units, so the screen has to know that
// quote to say the amount back in words a teacher can check.
const courseApi = vi.hoisted(() => ({ readCourse: vi.fn() }));

vi.mock('@/lib/courses', () => courseApi);

// `vi.hoisted`, because the mock factory runs while this file's imports are still resolving: the
// manager tells a failure through the kit's toast rather than the browser's own alert box.
const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'cp1',
    courseId: 'c1',
    code: 'SAVE20',
    discountType: 'percentage',
    discountAmount: 20,
    validFrom: null,
    validUntil: null,
    maxRedemptions: null,
    redemptionCount: 0,
    isActive: true,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

/** The course the codes hang off, quoted in rupees unless a test says otherwise. */
function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 'c1',
    title: 'Fractions, slowly',
    slug: 'fractions-slowly',
    summary: 'A first pass at the topic.',
    description: 'Start with one pie, end with adding any two fractions.',
    level: { code: 'beginner', label: 'Beginner' },
    status: { code: 'published', label: 'Published' },
    price: { minorUnits: 499900, currency: { code: 'INR', label: 'Indian rupee' } },
    demoBookingsEnabled: false,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  api.listCoupons.mockReset();
  api.createCoupon.mockReset();
  api.updateCoupon.mockReset();
  api.deactivateCoupon.mockReset();
  api.createCoupon.mockResolvedValue(coupon());
  api.updateCoupon.mockResolvedValue(coupon());
  api.deactivateCoupon.mockResolvedValue(coupon({ isActive: false }));
  api.listCoupons.mockResolvedValue([coupon()]);
  courseApi.readCourse.mockReset();
  courseApi.readCourse.mockResolvedValue(course());
});

async function openFormAndTypeCode(code: string) {
  await userEvent.click(await screen.findByRole('button', { name: /new coupon|create a coupon/i }));
  await userEvent.type(screen.getByLabelText(/^Code/), code);
}

describe('CouponManager', () => {
  it('shows each code, what it takes off, and how often it has been used', async () => {
    api.listCoupons.mockResolvedValue([
      coupon(),
      coupon({
        id: 'cp2',
        code: 'FLAT500',
        discountType: 'fixed',
        discountAmount: 5000,
        maxRedemptions: 3,
        redemptionCount: 3,
        isActive: false,
      }),
    ]);

    render(<CouponManager courseId="c1" />);

    expect(await screen.findByText('SAVE20')).toBeInTheDocument();
    expect(screen.getByText('20% off')).toBeInTheDocument();
    expect(screen.getByText('0 redemptions (unlimited)')).toBeInTheDocument();

    expect(screen.getByText('FLAT500')).toBeInTheDocument();
    expect(screen.getByText('3 redemptions / 3')).toBeInTheDocument();
    // The read is the codes still on offer — the API's list filters the retired ones out — so a
    // row that could wear an "Inactive" pill is a state this screen is never shown, and every
    // row it is shown would say "Active" without meaning anything by it.
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    // The number is in the course's own price units, and this course is quoted in rupees.
    expect(screen.getByText('₹50.00 off')).toBeInTheDocument();
  });

  it('prices a fixed code in the currency the course is quoted in, not in a default', async () => {
    courseApi.readCourse.mockResolvedValue(
      course({ price: { minorUnits: 100000, currency: { code: 'USD', label: 'US dollar' } } }),
    );
    api.listCoupons.mockResolvedValue([
      coupon({ discountType: 'fixed', discountAmount: 5000, code: 'FLAT50' }),
    ]);

    render(<CouponManager courseId="c1" />);

    expect(await screen.findByText('$50.00 off')).toBeInTheDocument();
    expect(screen.queryByText('₹50.00 off')).not.toBeInTheDocument();
  });

  it('leaves a fixed code without a unit when the course carries no price', async () => {
    courseApi.readCourse.mockResolvedValue(course({ price: null }));
    api.listCoupons.mockResolvedValue([
      coupon({ discountType: 'fixed', discountAmount: 5000, code: 'FLAT50' }),
    ]);

    render(<CouponManager courseId="c1" />);

    // The API will not redeem a fixed discount against a course with no quote, so naming a
    // currency here would be a promise the enrollment cannot keep.
    expect(await screen.findByText(/no price/i)).toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it('tells the teacher what the amount column means, in the course’s currency', async () => {
    courseApi.readCourse.mockResolvedValue(
      course({ price: { minorUnits: 100000, currency: { code: 'USD', label: 'US dollar' } } }),
    );

    render(<CouponManager courseId="c1" />);

    await userEvent.click(await screen.findByRole('button', { name: /new coupon/i }));
    await userEvent.selectOptions(screen.getByLabelText(/^Discount Type/), 'fixed');

    expect(screen.getByText(/2000 = \$20\.00/)).toBeInTheDocument();
  });

  it('offers a retry when the codes did not arrive, and reads them again on the press', async () => {
    api.listCoupons.mockRejectedValueOnce(new Error('The read side is having a bad morning.'));

    render(<CouponManager courseId="c1" />);

    await screen.findByRole('heading', { name: /did not (load|arrive)/i });
    expect(screen.queryByText('SAVE20')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('SAVE20')).toBeInTheDocument();
  });

  it('offers a way to write the first code when the course has none', async () => {
    api.listCoupons.mockResolvedValue([]);

    render(<CouponManager courseId="c1" />);

    await openFormAndTypeCode('OPENING');

    expect(screen.getByRole('heading', { name: /create coupon/i })).toBeInTheDocument();
  });

  it('sends a code in caps and repaints from what the API says is there now', async () => {
    api.listCoupons
      .mockResolvedValueOnce([coupon()])
      .mockResolvedValueOnce([coupon(), coupon({ id: 'cp2', code: 'NEWCODE' })]);

    render(<CouponManager courseId="c1" />);

    await openFormAndTypeCode('newcode');
    await userEvent.type(screen.getByLabelText(/^Discount Amount/), '15');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await vi.waitFor(() =>
      expect(api.createCoupon).toHaveBeenCalledWith('c1', {
        code: 'NEWCODE',
        discountType: 'percentage',
        discountAmount: 15,
        validFrom: null,
        validUntil: null,
        maxRedemptions: null,
      }),
    );
    expect(await screen.findByText('NEWCODE')).toBeInTheDocument();
    expect(api.listCoupons).toHaveBeenCalledTimes(2);
  });

  it('opens an edit holding the code it edits, and sends the change back', async () => {
    render(<CouponManager courseId="c1" />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    expect(screen.getByLabelText(/^Code/)).toHaveValue('SAVE20');

    await userEvent.clear(screen.getByLabelText(/^Discount Amount/));
    await userEvent.type(screen.getByLabelText(/^Discount Amount/), '25');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    await vi.waitFor(() =>
      expect(api.updateCoupon).toHaveBeenCalledWith('c1', 'cp1', {
        code: undefined,
        discountAmount: 25,
        validFrom: null,
        validUntil: null,
        maxRedemptions: null,
      }),
    );
    expect(api.createCoupon).not.toHaveBeenCalled();
  });

  it('sends a new code when the teacher retypes one', async () => {
    render(<CouponManager courseId="c1" />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    await userEvent.clear(screen.getByLabelText(/^Code/));
    await userEvent.type(screen.getByLabelText(/^Code/), 'launchweek');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    await vi.waitFor(() =>
      expect(api.updateCoupon).toHaveBeenCalledWith(
        'c1',
        'cp1',
        expect.objectContaining({ code: 'LAUNCHWEEK' }),
      ),
    );
  });

  it('closes the edit form when the coupon it holds is retired', async () => {
    render(<CouponManager courseId="c1" />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('button', { name: /deactivate/i }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));

    await vi.waitFor(() => expect(api.deactivateCoupon).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
  });

  it('asks the question in a sheet of its own, and only retires the code once the answer is in it', async () => {
    const confirm = vi.spyOn(window, 'confirm');

    render(<CouponManager courseId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: /deactivate/i }));

    // The row's button opens the question instead of answering it: a code is retired on purpose,
    // not because a pointer landed on the wrong side of a table.
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Deactivate SAVE20?')).toBeInTheDocument();
    expect(api.deactivateCoupon).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    await userEvent.click(within(sheet).getByRole('button', { name: 'Deactivate' }));
    await vi.waitFor(() => expect(api.deactivateCoupon).toHaveBeenCalledWith('c1', 'cp1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    confirm.mockRestore();
  });

  it('leaves the code live when the teacher says keep it, and takes the sheet away', async () => {
    render(<CouponManager courseId="c1" />);

    await userEvent.click(await screen.findByRole('button', { name: /deactivate/i }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep it' }));

    expect(api.deactivateCoupon).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says a failed retirement in the page, over the list it belongs to, rather than in a system box', async () => {
    const alert = vi.spyOn(window, 'alert');
    api.deactivateCoupon.mockRejectedValueOnce(new Error('Only an active coupon can be retired.'));

    render(<CouponManager courseId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: /deactivate/i }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));

    await vi.waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Only an active coupon can be retired.'),
    );
    expect(alert).not.toHaveBeenCalled();
    // The sheet is gone either way: the teacher reads what failed against the list, not a dialog
    // that stands between them and it.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    alert.mockRestore();
  });
});
