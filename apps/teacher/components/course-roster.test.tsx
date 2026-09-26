import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Course, CourseRosterEntry, CourseRosterResponse } from '@lms/shared';

import { CourseRoster } from './course-roster';

// Hoisted: `vi.mock` calls move above the imports, so a factory may only close over values that
// exist before this file's body runs.
const api = vi.hoisted(() => ({ courseRoster: vi.fn(), readCourse: vi.fn() }));
const session = vi.hoisted(() => ({ user: { timezone: 'UTC' } }));

vi.mock('@/lib/roster', () => ({ courseRoster: api.courseRoster }));
vi.mock('@/lib/courses', () => ({ readCourse: api.readCourse }));
vi.mock('./session-provider', () => ({
  useSession: () => ({ status: 'signed-in', user: session.user }),
}));

const COURSE: Course = {
  id: 'c1',
  title: 'Fractions, slowly',
  slug: 'fractions-slowly',
  summary: 'A first pass at the topic.',
  description: 'Start with one pie, end with adding any two fractions.',
  level: { code: 'beginner', label: 'Beginner' },
  status: { code: 'published', label: 'Published' },
  price: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
};

function entry(overrides: Partial<CourseRosterEntry> = {}): CourseRosterEntry {
  return {
    student: { id: 's1', fullName: 'Sima Kundu' },
    enrolledAt: '2026-09-21T09:30:00.000Z',
    ...overrides,
  };
}

function roster(items: CourseRosterEntry[], overrides: Partial<CourseRosterResponse> = {}) {
  return {
    items,
    page: 1,
    pageSize: 2,
    total: items.length,
    ...overrides,
  } satisfies CourseRosterResponse;
}

beforeEach(() => {
  // Vitest here has no `clearMocks`, and a hoisted mock would carry call counts between tests.
  api.courseRoster.mockReset();
  api.readCourse.mockReset();
  api.readCourse.mockResolvedValue(COURSE);
  api.courseRoster.mockResolvedValue(
    roster([
      entry(),
      entry({
        student: { id: 's2', fullName: 'Nab Ahuja' },
        enrolledAt: '2026-09-19T05:00:00.000Z',
      }),
    ]),
  );
});

describe('CourseRoster', () => {
  it('names each student and the day their place opened, in the order the API sent', async () => {
    render(<CourseRoster courseId="c1" />);
    await screen.findAllByRole('listitem');

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('h3')?.textContent)).toEqual([
      'Sima Kundu',
      'Nab Ahuja',
    ]);
    expect(within(rows[0] as HTMLElement).getByText('Enrolled 21 Sept 2026')).toBeInTheDocument();
  });

  it('counts the whole class from the API rather than the rows on this page', async () => {
    api.courseRoster.mockResolvedValue(roster([entry()], { page: 1, pageSize: 2, total: 31 }));

    render(<CourseRoster courseId="c1" />);

    expect(await screen.findByText('31 on the roster')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('pages a class that does not fit, and asks the API for the page it names', async () => {
    api.courseRoster.mockResolvedValue(roster([entry()], { total: 3, pageSize: 2 }));

    render(<CourseRoster courseId="c1" />);
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeDisabled();

    api.courseRoster.mockResolvedValue(
      roster([entry({ student: { id: 's3', fullName: 'Om Menon' } })], { page: 2, total: 3 }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await vi.waitFor(() => expect(api.courseRoster).toHaveBeenCalledWith('c1', 2));
    expect(await screen.findByText('Om Menon')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  it('offers no paging for a class that fits on one page', async () => {
    render(<CourseRoster courseId="c1" />);
    await screen.findAllByRole('listitem');

    expect(screen.queryByRole('button', { name: /page$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Page/)).not.toBeInTheDocument();
  });

  it('says so when nobody has taken a place yet', async () => {
    api.courseRoster.mockResolvedValue(roster([]));

    render(<CourseRoster courseId="c1" />);

    expect(await screen.findByText(/nobody has taken a place/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('names the course the roster belongs to, and links back to the work around it', async () => {
    render(<CourseRoster courseId="c1" />);

    expect(await screen.findByText('Fractions, slowly')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Syllabus' })).toHaveAttribute(
      'href',
      '/courses/c1/modules',
    );
    expect(screen.getByRole('link', { name: 'Course details' })).toHaveAttribute(
      'href',
      '/courses/c1/edit',
    );
  });

  it('shows a refusal with a way to ask again, and asks for the same page it was on', async () => {
    api.courseRoster.mockRejectedValueOnce(new Error('The API is unreachable.'));

    render(<CourseRoster courseId="c1" />);

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Sima Kundu')).toBeInTheDocument();
    expect(api.courseRoster).toHaveBeenLastCalledWith('c1', 1);
  });

  it('says a name and a day, and invents nothing the API did not send', async () => {
    render(<CourseRoster courseId="c1" />);
    const list = await screen.findByRole('list');

    // The API keeps an address off a roster; a screen that reconstructed one would undo that.
    expect(list.textContent).not.toContain('@');
    expect(list.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
