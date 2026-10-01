'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Illo,
  Select,
  SkeletonGroup,
  TextField,
  notify,
} from '@lms/ui';
import { formatMoney, type Coupon } from '@lms/shared';

import { describeFailure, fieldErrors } from '@/lib/api';
import { readCourse } from '@/lib/courses';
import { createCoupon, deactivateCoupon, listCoupons, updateCoupon } from '@/lib/coupons';

/**
 * The discount codes one course carries.
 *
 * A code says how much comes off and never in which unit — the unit belongs to the course's
 * quote, and the enrollment takes this number off that price. So the screen reads both halves at
 * once: the codes on offer and the quote they come off, and every amount it prints is in the
 * currency the teacher actually quoted rather than a default one guessed at.
 */

/** What one code takes off, in the units the course is quoted in. */
function discountLabel(coupon: Coupon, currency: string | null): string {
  if (coupon.discountType === 'percentage') {
    return `${coupon.discountAmount}% off`;
  }
  if (currency === null) {
    // There is no unit to name. The API will not redeem a fixed amount against a course with no
    // price, so the number here is waiting for the quote that gives it a meaning.
    return `${coupon.discountAmount} off — this course has no price to take it from`;
  }
  return `${formatMoney({ minorUnits: coupon.discountAmount, currency })} off`;
}

function formatValidity(coupon: Coupon) {
  const from = coupon.validFrom ? new Date(coupon.validFrom).toLocaleDateString() : 'anytime';
  const until = coupon.validUntil ? new Date(coupon.validUntil).toLocaleDateString() : 'forever';
  return `${from} — ${until}`;
}

const DISCOUNT_TYPES = [
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed', label: 'Fixed amount' },
];

interface FormValues {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountAmount: string;
  validFrom: string;
  validUntil: string;
  maxRedemptions: string;
}

const BLANK: FormValues = {
  code: '',
  discountType: 'percentage',
  discountAmount: '',
  validFrom: '',
  validUntil: '',
  maxRedemptions: '',
};

export function CouponManager({ courseId }: { courseId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    key: string;
    coupons: Coupon[];
    currency: string | null;
  } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>(BLANK);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  // The row whose retirement is being asked about, and whether the answer is on its way to the API.
  const [retiring, setRetiring] = useState<Coupon | null>(null);
  const [retiringBusy, setRetiringBusy] = useState(false);

  // One answer for both halves, tagged with the request that earned it: a code's amount is only a
  // sum beside the quote it comes off, and a retry has to be able to ask the same question again.
  const key = `${courseId}:${attempt}`;
  const ready = settled?.key === key ? settled : null;
  const failed = failure?.key === key ? failure : null;
  const currency = ready?.currency ?? null;

  useEffect(() => {
    let alive = true;
    Promise.all([listCoupons(courseId), readCourse(courseId)])
      .then(([coupons, course]) => {
        if (alive) setSettled({ key, coupons, currency: course.price?.currency.code ?? null });
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });
    return () => {
      alive = false;
    };
  }, [key, courseId]);

  function reload() {
    setAttempt((current) => current + 1);
  }

  function set<Field extends keyof FormValues>(field: Field, value: FormValues[Field]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function openForm(coupon?: Coupon) {
    setValues(
      coupon
        ? {
            code: coupon.code,
            discountType: coupon.discountType,
            discountAmount: String(coupon.discountAmount),
            validFrom: coupon.validFrom?.split('T')[0] ?? '',
            validUntil: coupon.validUntil?.split('T')[0] ?? '',
            maxRedemptions: coupon.maxRedemptions?.toString() ?? '',
          }
        : BLANK,
    );
    setEditingId(coupon?.id ?? null);
    setEditingCode(coupon?.code ?? null);
    setFields({});
    setShowForm(true);
  }

  function closeForm() {
    setValues(BLANK);
    setEditingId(null);
    setEditingCode(null);
    setFields({});
    setShowForm(false);
  }

  /** The two mistakes a teacher can make by typing, said before the request is made. */
  function amountProblem(): string | null {
    const amount = Number(values.discountAmount);
    if (values.discountAmount.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      return 'Give an amount of zero or more.';
    }
    if (values.discountType === 'percentage' && amount > 100) {
      return 'A percentage is between 0 and 100.';
    }
    return null;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setFields({});

    const problem = amountProblem();
    if (problem) {
      setFields({ discountAmount: [problem] });
      return;
    }

    const amount = Number(values.discountAmount);
    const code = values.code.toUpperCase();
    // An empty box is "no bound", not "leave what is there": the API reads null as open-ended.
    const bounds = {
      validFrom: values.validFrom || null,
      validUntil: values.validUntil || null,
      maxRedemptions: values.maxRedemptions ? Number(values.maxRedemptions) : null,
    };

    setSubmitting(true);
    try {
      if (editingId) {
        await updateCoupon(courseId, editingId, {
          // A coupon is found by its code, so the field only goes to the API when the teacher
          // actually retyped it; leaving it alone must not look like a rename.
          code: code === editingCode ? undefined : code,
          discountAmount: amount,
          ...bounds,
        });
      } else {
        await createCoupon(courseId, {
          code,
          discountType: values.discountType,
          discountAmount: amount,
          ...bounds,
        });
      }

      // Repaint from what the API says the course carries now, not from the row that was sent.
      reload();
      closeForm();
    } catch (error: unknown) {
      const errs = fieldErrors(error);
      if (errs) {
        setFields(errs);
      } else {
        notify.error(describeFailure(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function retire(coupon: Coupon) {
    setRetiringBusy(true);
    try {
      await deactivateCoupon(courseId, coupon.id);
      // A form left open on a code that just stopped working would write back to a dead row.
      if (editingId === coupon.id) closeForm();
      reload();
      setRetiring(null);
    } catch (error: unknown) {
      setRetiring(null);
      notify.error(describeFailure(error));
    } finally {
      setRetiringBusy(false);
    }
  }

  if (failed) {
    return (
      <ErrorState
        title="The coupons did not load"
        message={failed.message}
        onRetry={reload}
        busy={submitting}
      />
    );
  }

  if (!ready) {
    return (
      <SkeletonGroup
        rows={3}
        rowClassName="h-16"
        label="Loading the course coupons"
        className="space-y-3"
      />
    );
  }

  if (ready.coupons.length === 0 && !showForm) {
    return (
      <EmptyState
        illustration={<Illo src="/illustrations/peep-standing-11.svg" size="lg" />}
        title="No coupons yet"
        description="Create discount codes to offer reduced pricing for this course."
        actionLabel="Create a coupon"
        onAction={() => openForm()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-h3 text-ink-strong">Coupons</h3>
        {!showForm && <Button onClick={() => openForm()}>New coupon</Button>}
      </div>

      {showForm && (
        <Card className="p-5">
          <form onSubmit={save} className="space-y-4">
            <h4 className="text-label text-ink-muted">
              {editingId ? 'Edit coupon' : 'Create coupon'}
            </h4>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="code"
                label="Code"
                value={values.code}
                onChange={(event) => set('code', event.target.value.toUpperCase())}
                placeholder="SAVE20"
                required
                error={fields.code}
              />
              <Select
                id="discountType"
                label="Discount Type"
                value={values.discountType}
                onChange={(event) =>
                  set('discountType', event.target.value as 'percentage' | 'fixed')
                }
                options={DISCOUNT_TYPES}
              />
              <TextField
                id="discountAmount"
                label="Discount Amount"
                type="number"
                value={values.discountAmount}
                onChange={(event) => set('discountAmount', event.target.value)}
                placeholder={values.discountType === 'percentage' ? '20' : '2000'}
                min="0"
                max={values.discountType === 'percentage' ? 100 : undefined}
                required
                hint={
                  values.discountType === 'percentage'
                    ? '0-100%'
                    : currency === null
                      ? 'Minor units of the course price. This course has no price yet, so a fixed amount has nothing to come off.'
                      : `Minor units: 2000 = ${formatMoney({ minorUnits: 2000, currency })}`
                }
                error={fields.discountAmount}
              />
              <TextField
                id="maxRedemptions"
                label="Max Redemptions"
                type="number"
                value={values.maxRedemptions}
                onChange={(event) => set('maxRedemptions', event.target.value)}
                placeholder="Unlimited"
                min="1"
                hint="Leave empty for no limit."
                error={fields.maxRedemptions}
              />
              <TextField
                id="validFrom"
                label="Valid From"
                type="date"
                value={values.validFrom}
                onChange={(event) => set('validFrom', event.target.value)}
                hint="Leave empty for immediately."
                error={fields.validFrom}
              />
              <TextField
                id="validUntil"
                label="Valid Until"
                type="date"
                value={values.validUntil}
                onChange={(event) => set('validUntil', event.target.value)}
                hint="Leave empty for no end date."
                error={fields.validUntil}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </Button>
              <Button type="button" variant="secondary" onClick={closeForm} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* The codes still on offer, which is what the read returns: a retired code leaves the list
          rather than staying in it to be told apart, so no row wears a state pill. */}
      <Card className="divide-y divide-line">
        {ready.coupons.map((coupon) => (
          <div key={coupon.id} className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="font-mono text-[0.9375rem] font-semibold text-ink">{coupon.code}</p>
              <p className="mt-0.5 text-[0.9375rem] text-ink-muted">
                {discountLabel(coupon, currency)}
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">{formatValidity(coupon)}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {coupon.redemptionCount} redemption{coupon.redemptionCount !== 1 ? 's' : ''}
                {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ' (unlimited)'}
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Edit ${coupon.code}`}
                onClick={() => openForm(coupon)}
              >
                Edit
              </Button>
              <Button size="sm" variant="danger" onClick={() => setRetiring(coupon)}>
                Deactivate
              </Button>
            </div>
          </div>
        ))}
      </Card>

      <ConfirmDialog
        open={retiring !== null}
        busy={retiringBusy}
        tone="danger"
        title={retiring ? `Deactivate ${retiring.code}?` : ''}
        message="It can no longer be used for enrollment."
        confirmLabel="Deactivate"
        cancelLabel="Keep it"
        onConfirm={() => {
          if (retiring) void retire(retiring);
        }}
        onClose={() => setRetiring(null)}
      />
    </div>
  );
}
