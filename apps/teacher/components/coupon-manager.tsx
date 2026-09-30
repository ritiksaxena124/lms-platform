'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Illo,
  SkeletonGroup,
  StatusPill,
  type StatusTone,
} from '@lms/ui';
import type { Coupon } from '@lms/shared';

import { describeFailure } from '@/lib/api';
import { listCoupons, createCoupon, updateCoupon, deactivateCoupon } from '@/lib/coupons';

const DISCOUNT_TYPE_LABELS: Record<string, string> = {
  percentage: 'Percentage',
  fixed: 'Fixed Amount',
};

const STATUS_TONE: Record<boolean, StatusTone> = {
  true: 'success',
  false: 'neutral',
};

/** Format a discount amount for display */
function formatDiscount(coupon: Coupon) {
  if (coupon.discountType === 'percentage') {
    return `${coupon.discountAmount}% off`;
  }
  return `$${(coupon.discountAmount / 100).toFixed(2)} off`;
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

  // Form state
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountAmount, setDiscountAmount] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadCoupons = async () => {
    try {
      setLoading(true);
      const data = await listCoupons(courseId);
      setCoupons(data);
      setError(null);
    } catch (err: unknown) {
      const { message } = describeFailure(err);
      setError({ message });
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
  };

  const startEdit = (coupon: Coupon) => {
    setEditingId(coupon.id);
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
        await updateCoupon(courseId, editingId, {
          code: payload.code !== code.toUpperCase() ? payload.code : undefined,
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

  const handleDeactivate = async (couponId: string) => {
    if (!confirm('Deactivate this coupon? It can no longer be used for enrollment.')) {
      return;
    }

    try {
      await deactivateCoupon(courseId, couponId);
      await loadCoupons();
    } catch (err: unknown) {
      const { message } = describeFailure(err);
      alert(`Failed to deactivate: ${message}`);
    }
  };

  if (loading) {
    return (
      <SkeletonGroup>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-gray-100" />
          ))}
        </div>
      </SkeletonGroup>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load coupons"
        message={error.message}
        action={<Button onClick={loadCoupons}>Try Again</Button>}
      />
    );
  }

  if (!coupons || coupons.length === 0) {
    return (
      <EmptyState
        icon={<Illo name="empty-state" />}
        title="No coupons yet"
        description="Create discount codes to offer reduced pricing for this course."
        action={
          <Button onClick={() => setShowForm(true)}>
            <Icon name="plus" className="mr-2 h-4 w-4" />
            Create Coupon
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Coupons</h3>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Icon name="plus" className="mr-2 h-4 w-4" />
            New Coupon
          </Button>
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
                {discountType === 'percentage' ? '0-100%' : 'In cents (e.g., 2000 = $20.00)'}
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
                  <StatusPill tone={STATUS_TONE[coupon.isActive]}>
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
                    <Button size="sm" variant="ghost" onClick={() => startEdit(coupon)}>
                      <Icon name="edit" className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDeactivate(coupon.id)}
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
    </div>
  );
}
