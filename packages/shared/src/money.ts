/**
 * Money is stored and moved as integer minor units (paise/cents) plus an ISO 4217
 * currency. Floats are never used for amounts, and the POC assumes a single currency
 * per price without encoding that assumption into the types.
 */
export interface Money {
  minorUnits: number;
  currency: string;
}

const CURRENCY_MINOR_DIGITS: Record<string, number> = { JPY: 0, KWD: 3 };

function minorDigits(currency: string): number {
  return CURRENCY_MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

export function toMinorUnits(major: string | number, currency: string): number {
  const value = typeof major === 'number' ? major.toString() : major.trim();
  if (!/^-?\d*(\.\d*)?$/.test(value) || value === '' || value === '.' || value === '-') {
    throw new Error(`Invalid amount: ${major}`);
  }
  const digits = minorDigits(currency);
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
  if (fraction.length > digits) {
    throw new Error(`Amount ${value} has more than ${digits} decimal places for ${currency}`);
  }
  const scaled = Number(
    BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0')),
  );
  return negative ? -scaled : scaled;
}

export function fromMinorUnits(minorUnits: number, currency: string): string {
  if (!Number.isInteger(minorUnits)) {
    throw new Error(`Minor units must be an integer, received ${minorUnits}`);
  }
  const digits = minorDigits(currency);
  const sign = minorUnits < 0 ? '-' : '';
  const abs = Math.abs(minorUnits)
    .toString()
    .padStart(digits + 1, '0');
  if (digits === 0) return `${sign}${abs}`;
  return `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

export function formatMoney({ minorUnits, currency }: Money, locale = 'en-IN'): string {
  const code = currency.toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: minorDigits(code),
    maximumFractionDigits: minorDigits(code),
  }).format(Number(fromMinorUnits(minorUnits, code)));
  return `${symbol}${formatted}`;
}
