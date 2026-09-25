import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card, CardHeader } from './Card';
import { Stagger } from '../motion/Stagger';

describe('Card', () => {
  it('draws a hairline border rather than a floating box by default', () => {
    const { container } = render(<Card>Next class: Tuesday 6pm</Card>);
    const card = container.firstElementChild as HTMLElement;

    expect(card).toHaveClass('rounded-card', 'border-line', 'shadow-hairline');
    expect(card).toHaveClass('p-5');
  });

  it('lets a table or media block own its edges', () => {
    const { container } = render(<Card padding="flush">Bookings table</Card>);
    expect(container.firstElementChild).not.toHaveClass('p-5');
  });

  it('lifts on hover only when it is actually clickable', () => {
    const { container, rerender } = render(<Card>Static summary</Card>);
    expect(container.firstElementChild).not.toHaveClass(/hover:-translate-y-px/);

    rerender(<Card interactive>Open course</Card>);
    expect(container.firstElementChild).toHaveClass('hover:-translate-y-px');
  });
  it('passes reveal attributes through so <Stagger> can animate a grid of cards', () => {
    render(
      <Stagger>
        <Card>First metric</Card>
        <Card>Second metric</Card>
      </Stagger>,
    );

    const [first, second] = screen.getAllByText(/metric/) as HTMLElement[];
    expect(first?.getAttribute('data-reveal')).toBe('');
    expect(first?.style.getPropertyValue('--reveal-delay')).toBe('0ms');
    expect(second?.style.getPropertyValue('--reveal-delay')).toBe('36ms');
  });
});

describe('CardHeader', () => {
  it('puts the eyebrow, title and description in a readable order', () => {
    render(
      <CardHeader
        eyebrow="This week"
        title="Earnings"
        description="Payouts land on the 1st."
        actions={<button type="button">Export</button>}
      />,
    );

    // The eyebrow is upper-cased by CSS only; the DOM keeps the caller's wording.
    expect(screen.getByText('This week')).toHaveClass('eyebrow');
    expect(screen.getByRole('heading', { level: 2, name: 'Earnings' })).toBeInTheDocument();
    expect(screen.getByText('Payouts land on the 1st.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });
});
