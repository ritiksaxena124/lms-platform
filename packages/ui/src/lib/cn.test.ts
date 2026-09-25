import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  it('joins conditional classes', () => {
    const busy = false;
    expect(cn('btn', busy && 'btn--busy', undefined, 'btn--lg')).toBe('btn btn--lg');
  });

  it('lets the last conflicting Tailwind utility win so call sites can override', () => {
    expect(cn('px-4 py-2 text-sm', 'px-6')).toBe('py-2 text-sm px-6');
  });

  it('resolves arbitrary-value variants against the token scale', () => {
    expect(cn('text-[var(--color-ink)]', 'text-[var(--color-clay)]')).toBe(
      'text-[var(--color-clay)]',
    );
  });
});
