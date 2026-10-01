'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Illo,
  SkeletonGroup,
  StatusPill,
  notify,
  type StatusTone,
} from '@lms/ui';
import { formatMoney, type Coupon } from '@lms/shared';

import { describeFailure } from '@/lib/api';
import { listCoupons, createCoupon, updateCoupon, deactivateCoupon } from '@/lib/coupons';

function statusTone(isActive: boolean): StatusTone {
  return isActive ? 'success' : 'neutral';
}

/** Format a discount amount for display */
function formatDiscount(coupon: Coupon) {
  if (coupon.discountType === 'percentage') {
    return `${coupon.discountAmount}% off`;
  }
  return `${formatMoney({ minorUnits: coupon.discountAmount, currency: 'INR' })} off`;
}

/** Format validity period */
function formatValidity(coupon: Coupon) {
  const from = coupon.validFrom ? new Date(coupon.validFrom).toLocaleDateString() : 'anytime';
  const until = coupon.validUntil ? new Date(coupon.validUntil).toLocaleDateString() : 'forever';
  return `${from} — ${until}`;
}

export function CouponManager({ courseId }: { courseId: string }) {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);

  // Form state
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountAmount, setDiscountAmount] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The row whose retirement is being asked about, and whether the answer is on its way to the API.
  const [retiring, setRetiring] = useState<Coupon | null>(null);
  const [retiringBusy, setRetiringBusy] = useState(false);

  const loadCoupons = async () => {
    try {
      setLoading(true);
      const data = await listCoupons(courseId);
      setCoupons(data);
      setError(null);
    } catch (err: unknown) {
      setError({ message: describeFailure(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCoupons();
  }, [courseId]);

  const resetForm = () => {
    setCode('');
    setDiscountType('percentage');
    setDiscountAmount('');
    setValidFrom('');
    setValidUntil('');
    setMaxRedemptions('');
    setFormError(null);
    setShowForm(false);
    setEditingId(null);
    setEditingCode(null);
  };

  const startEdit = (coupon: Coupon) => {
    setEditingId(coupon.id);
    setEditingCode(coupon.code);
    setCode(coupon.code);
    setDiscountType(coupon.discountType);
    setDiscountAmount(String(coupon.discountAmount));
    setValidFrom(coupon.validFrom?.split('T')[0] ?? '');
    setValidUntil(coupon.validUntil?.split('T')[0] ?? '');
    setMaxRedemptions(coupon.maxRedemptions?.toString() ?? '');
    setFormError(null);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const amount = parseInt(discountAmount, 10);
      if (isNaN(amount) || amount < 0) {
        throw new Error('Discount amount must be a non-negative number');
      }

      if (discountType === 'percentage' && (amount < 0 || amount > 100)) {
        throw new Error('Percentage discount must be between 0 and 100');
      }

      const payload = {
        code: code.toUpperCase(),
        discountType,
        discountAmount: amount,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
        maxRedemptions: maxRedemptions ? parseInt(maxRedemptions, 10) : null,
      };

      if (editingId) {
        const next = code.toUpperCase();
        await updateCoupon(courseId, editingId, {
          // A coupon is found by its code, so the field only goes to the API when the teacher
          // actually retyped it; leaving it alone must not look like a rename.
          code: next === editingCode ? undefined : next,
          discountAmount: payload.discountAmount,
          validFrom: payload.validFrom,
          validUntil: payload.validUntil,
          maxRedemptions: payload.maxRedemptions,
        });
      } else {
        await createCoupon(courseId, payload);
      }

      await loadCoupons();
      resetForm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save coupon';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const retireCoupon = async (coupon: Coupon) => {
    setRetiringBusy(true);
    try {
      await deactivateCoupon(courseId, coupon.id);
      // A form left open on a code that just stopped working would write back to a dead row.
      if (editingId === coupon.id) resetForm();
      await loadCoupons();
      setRetiring(null);
    } catch (err: unknown) {
      setRetiring(null);
      notify.error(describeFailure(err));
    } finally {
      setRetiringBusy(false);
    }
  };

  if (loading) {
    return (
      <SkeletonGroup
        rows={3}
        rowClassName="h-16"
        label="Loading the course coupons"
        className="space-y-3"
      />
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load coupons"
        message={error.message}
        onRetry={loadCoupons}
      />
    );
  }

  if (!coupons || (coupons.length === 0 && !showForm)) {
    return (
      <EmptyState
        illustration={<Illo src="/illustrations/peep-standing-11.svg" size="lg" />}
        title="No coupons yet"
        description="Create discount codes to offer reduced pricing for this course."
        actionLabel="Create a coupon"
        onAction={() => setShowForm(true)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Coupons</h3>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>New Coupon</Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border p-4 space-y-4 bg-gray-50">
          <h4 className="font-medium">{editingId ? 'Edit Coupon' : 'Create Coupon'}</h4>

          {formError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{formError}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium mb-1">
                Code *
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SAVE20"
                required
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="discountType" className="block text-sm font-medium mb-1">
                Discount Type *
              </label>
              <select
                id="discountType"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'percentage' | 'fixed')}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed Amount</option>
              </select>
            </div>

            <div>
              <label htmlFor="discountAmount" className="block text-sm font-medium mb-1">
                Discount Amount *
              </label>
              <input
                id="discountAmount"
                type="number"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder={discountType === 'percentage' ? '20' : '2000'}
                min="0"
                max={discountType === 'percentage' ? 100 : undefined}
                required
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                {discountType === 'percentage' ? '0-100%' : 'Minor units: 2000 = ₹20.00'}
              </p>
            </div>

            <div>
              <label htmlFor="maxRedemptions" className="block text-sm font-medium mb-1">
                Max Redemptions
              </label>
              <input
                id="maxRedemptions"
                type="number"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                placeholder="Unlimited"
                min="1"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="validFrom" className="block text-sm font-medium mb-1">
                Valid From
              </label>
              <input
                id="validFrom"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="validUntil" className="block text-sm font-medium mb-1">
                Valid Until
              </label>
              <input
                id="validUntil"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </Button>
            <Button type="button" variant="secondary" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {coupons.map((coupon) => (
          <div key={coupon.id} className="rounded-lg border p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sm font-semibold">{coupon.code}</span>
                  <StatusPill tone={statusTone(coupon.isActive)}>
                    {coupon.isActive ? 'Active' : 'Inactive'}
                  </StatusPill>
                </div>
                <p className="text-sm text-gray-700">{formatDiscount(coupon)}</p>
                <p className="text-xs text-gray-500 mt-1">{formatValidity(coupon)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {coupon.redemptionCount} redemption{coupon.redemptionCount !== 1 ? 's' : ''}
                  {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ' (unlimited)'}
                </p>
              </div>

              <div className="flex gap-2">
                {coupon.isActive && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit ${coupon.code}`}
                      onClick={() => startEdit(coupon)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setRetiring(coupon)}
                    >
                      Deactivate
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={retiring !== null}
        busy={retiringBusy}
        tone="danger"
        title={retiring ? `Deactivate ${retiring.code}?` : ''}
        message="It can no longer be used for enrollment."
        confirmLabel="Deactivate"
        cancelLabel="Keep it"
        onConfirm={() => {
          if (retiring) void retireCoupon(retiring);
        }}
        onClose={() => setRetiring(null)}
      />
    </div>
  );
}
