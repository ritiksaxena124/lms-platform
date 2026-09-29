import { render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import Home from './page';

const ENV = {
  NEXT_PUBLIC_TEACHER_PORTAL_URL: 'http://teacher.localtest.me:3000',
  NEXT_PUBLIC_STUDENT_PORTAL_URL: 'http://student.localtest.me:3001',
};

describe('the landing page', () => {
  beforeAll(() => {
    for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  });

  afterAll(() => {
    for (const key of Object.keys(ENV)) delete process.env[key];
  });

  it('answers what the product is before the visitor has to look for it', () => {
    render(<Home />);

    const pitch = screen.getByRole('region', { name: /the class you teach/i });

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    // Scoped to the first screen rather than searched across the page, because both audiences are
    // described again further down and a match anywhere would prove the copy says it once somewhere.
    // This is the sentence a stranger decides on, and it has to name both sides — a marketplace whose
    // opening line mentions only one of them is a course site.
    expect(within(pitch).getByText(/independent teachers/i)).toBeInTheDocument();
    expect(within(pitch).getByText(/1:1/i)).toBeInTheDocument();
    expect(within(pitch).getByRole('link', { name: /teacher portal/i })).toBeInTheDocument();
  });

  it('gives a teacher and a learner their own way in', () => {
    render(<Home />);

    expect(screen.getByRole('link', { name: /teacher portal/i })).toHaveAttribute(
      'href',
      ENV.NEXT_PUBLIC_TEACHER_PORTAL_URL,
    );
    expect(screen.getByRole('link', { name: /student portal/i })).toHaveAttribute(
      'href',
      ENV.NEXT_PUBLIC_STUDENT_PORTAL_URL,
    );
  });

  it('walks one class, in the order it happens', () => {
    render(<Home />);

    // The loop is the product. A visitor who reads these four lines should be able to say what the
    // software does before anybody explains it to them.
    const steps = screen.getByRole('list', { name: 'How a class happens' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(4);
    expect(steps.textContent).toMatch(/asks for a minute/i);
    expect(steps.textContent).toMatch(/the teacher answers/i);
    expect(steps.textContent).toMatch(/room/i);
    expect(steps.textContent).toMatch(/email/i);
  });

  it('says what is not built yet instead of going quiet about it', () => {
    render(<Home />);

    // A course shows a price and nothing is charged; a class is a single booked minute, not a
    // standing weekly slot. Both are coming, and a landing page that hides the difference is how a
    // teacher ends up promising a parent a payment that this platform cannot take.
    expect(screen.getByRole('region', { name: /what works today/i })).toBeInTheDocument();
    expect(screen.getByText(/no payment is taken/i)).toBeInTheDocument();
    expect(screen.getByText(/one booked minute|single booked/i)).toBeInTheDocument();
  });

  it('does not print the seeded demo password', () => {
    render(<Home />);

    // The accounts exist in the seed and the README names them for a person standing at their own
    // keyboard. This page has no such reader: a public demo credential is a door signed open.
    expect(screen.queryByText(/lms-demo-password/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/example\.test/);
  });
});
