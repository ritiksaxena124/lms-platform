import { formatMoney, type CoursePrice } from '@lms/shared';

/**
 * A course's price as a shopper reads it, or nothing at all.
 *
 * Three states, and collapsing them is the bug this guards against: `null` is a course nobody
 * has quoted (so the shelf says nothing about money — a "no price listed" line would start a
 * conversation the teacher never joined), `0` is a course priced at free (so it says `Free`, in
 * words, rather than a `₹0.00` that reads as a typo), and any other amount is printed with the
 * symbol of the currency the API sent beside it. Enrollment stays a place taken for free either
 * way; this is a quote, not a checkout.
 */
export function priceLabel(price: CoursePrice | null): string | null {
  if (!price) return null;
  if (price.minorUnits === 0) return 'Free';
  return formatMoney({ minorUnits: price.minorUnits, currency: price.currency.code });
}
