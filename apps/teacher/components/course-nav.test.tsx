import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CourseNav } from './course-nav';

/**
 * The strip is the answer to a question the course list cannot ask: once a teacher is standing on
 * one screen of a course, what else does that course have? Before this, `/courses/c1/series` and
 * `/courses/c1/coupons` were reachable only by typing them.
 */

function hrefs() {
  return screen.getAllByRole('link').map((link) => link.getAttribute('href'));
}

describe('the course screens strip', () => {
  it('links every screen one course owns, under that course', () => {
    render(<CourseNav courseId="c1" active="roster" />);

    expect(hrefs()).toEqual([
      '/courses/c1/edit',
      '/courses/c1/modules',
      '/courses/c1/roster',
      '/courses/c1/series',
      '/courses/c1/coupons',
    ]);
  });

  it('names where the strip is, and which screen it is naming', () => {
    render(<CourseNav courseId="c1" active="coupons" />);

    expect(screen.getByRole('navigation').getAttribute('aria-label')).toBe('Screens in this course');

    const current = screen.getByRole('link', { name: 'Coupons' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Roster' }).getAttribute('aria-current')).toBeNull();
  });

  it('carries the id it was handed rather than a slug', () => {
    // A teacher retitling a draft must not move the screens it links to.
    render(<CourseNav courseId="a-uuid-looking-id" active="series" />);

    expect(screen.getByRole('link', { name: 'Coupons' }).getAttribute('href')).toBe(
      '/courses/a-uuid-looking-id/coupons',
    );
  });

  it('keeps the syllabus lit while a lesson screen is open', () => {
    // The lessons screen is one level below the syllabus, not a sibling of it, so the strip has
    // no tab to land on there — and no tab lit at all would read as "you have left the course".
    render(<CourseNav courseId="c1" active="lessons" />);

    expect(
      screen.getByRole('link', { name: 'Syllabus' }).getAttribute('aria-current'),
    ).toBe('page');
  });
});
