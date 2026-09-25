import { describe, expect, it } from 'vitest';

import { formatMoney, fromMinorUnits, toMinorUnits } from './money';

describe('money in integer minor units', () => {
  it('converts major to minor without float rounding drift', () => {
    expect(toMinorUnits('19.99', 'USD')).toBe(1999);
    expect(toMinorUnits('0.1', 'USD')).toBe(10);
    expect(toMinorUnits('1234.56', 'INR')).toBe(123456);
    expect(toMinorUnits(2, 'USD')).toBe(200);
    expect(toMinorUnits('100', 'INR')).toBe(10000);
    expect(toMinorUnits('3500', 'JPY')).toBe(3500);
    expect(toMinorUnits('-5.25', 'USD')).toBe(-525);
  });

  it('adds repeatedly without losing a paisa', () => {
    const total = Array.from({ length: 10 }, () => toMinorUnits('0.10', 'INR')).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBe(100);
  });

  it('refuses amounts finer than the currency supports', () => {
    expect(() => toMinorUnits('1.999', 'USD')).toThrow(/more than 2 decimal places/);
    expect(() => toMinorUnits('10.5', 'JPY')).toThrow(/more than 0 decimal places/);
  });

  it('rejects non-numeric input rather than coercing to NaN', () => {
    for (const bad of ['', ' ', '-', '1,200', 'abc', '1.2.3']) {
      expect(() => toMinorUnits(bad, 'USD')).toThrow(/Invalid amount/);
    }
  });

  it('round-trips back to a decimal string', () => {
    expect(fromMinorUnits(123456, 'INR')).toBe('1234.56');
    expect(fromMinorUnits(5, 'INR')).toBe('0.05');
    expect(fromMinorUnits(0, 'USD')).toBe('0.00');
    expect(fromMinorUnits(-525, 'USD')).toBe('-5.25');
    expect(fromMinorUnits(3500, 'JPY')).toBe('3500');
    expect(() => fromMinorUnits(1.5, 'USD')).toThrow(/must be an integer/);
  });

  it('formats for display with symbol and locale grouping', () => {
    expect(formatMoney({ minorUnits: 123456, currency: 'INR' }, 'en-IN')).toBe('₹1,234.56');
    expect(formatMoney({ minorUnits: 120000, currency: 'USD' }, 'en-US')).toBe('$1,200.00');
    expect(formatMoney({ minorUnits: 3500, currency: 'JPY' }, 'ja-JP')).toBe('¥3,500');
    expect(formatMoney({ minorUnits: 250, currency: 'AUD' }, 'en-AU')).toBe('AUD 2.50');
  });
});
