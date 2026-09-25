import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it('pairs the colour dot with the text so status is never colour-only', () => {
    render(<StatusPill tone="success">Confirmed</StatusPill>);

    const pill = screen.getByText('Confirmed');
    expect(pill).toHaveAttribute('data-tone', 'success');
    expect(pill.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('defaults to the neutral tone', () => {
    render(<StatusPill>Draft</StatusPill>);
    expect(screen.getByText('Draft')).toHaveAttribute('data-tone', 'neutral');
  });

  it('can pulse to mean “happening right now”, without announcing itself as a live region', () => {
    render(
      <StatusPill tone="info" pulse>
        Class in 5 min
      </StatusPill>,
    );

    const pill = screen.getByText('Class in 5 min');
    expect(pill).toHaveAttribute('data-pulse', 'true');
    expect(pill).not.toHaveAttribute('aria-live');
  });
});
