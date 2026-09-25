import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContentReveal, RouteTransition } from './RouteTransition';

describe('RouteTransition', () => {
  it('renders page content untouched when no transition is running', () => {
    render(
      <RouteTransition>
        <section>
          <h1>My courses</h1>
        </section>
      </RouteTransition>,
    );

    expect(screen.getByRole('heading', { name: 'My courses' })).toBeInTheDocument();
  });
});

describe('ContentReveal', () => {
  it('shows loaded data in place of the fallback', async () => {
    render(
      <ContentReveal fallback={<p>Loading bookings</p>}>
        <p>4 bookings this week</p>
      </ContentReveal>,
    );

    expect(await screen.findByText('4 bookings this week')).toBeInTheDocument();
    expect(screen.queryByText('Loading bookings')).not.toBeInTheDocument();
  });
});
