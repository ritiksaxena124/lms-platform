import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Course } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { CourseList } from './course-list';

// Hoisted: `vi.mock` calls move above the imports, so a factory may only close over values
// that exist before this file's body runs.
const api = vi.hoisted(() => ({
  listCourses: vi.fn(),
  publishCourse: vi.fn(),
  archiveCourse: vi.fn(),
}));

vi.mock('@/lib/courses', () => api);

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 'c1',
    title: 'Fractions, slowly',
    slug: 'fractions-slowly',
    summary: 'A first pass at the topic.',
    description: 'Start with one pie, end with adding any two fractions.',
    level: { code: 'beginner', label: 'Beginner' },
    status: { code: 'draft', label: 'Draft' },
    price: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

const PUBLISHED = course({
  id: 'c2',
  title: 'Verbs in passing',
  slug: 'verbs-in-passing',
  status: { code: 'published', label: 'Published' },
  level: { code: 'intermediate', label: 'Intermediate' },
});

const DRAFT = course();

function validationError(): ApiError {
  return new ApiError({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'A course needs a summary and a description before anyone can read it.',
    details: { validation: { description: ['Fill this in before publishing.'] } },
  });
}

function rows(): HTMLElement[] {
  return screen.getAllByRole('listitem');
}

function rowOf(title: string): HTMLElement {
  const list = screen.getByRole('list');
  const match = [...list.querySelectorAll('li')].find((node) => node.textContent?.includes(title));
  if (!match) throw new Error(`No row for ${title}`);
  return match as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listCourses.mockResolvedValue([DRAFT, PUBLISHED]);
});

describe('CourseList', () => {
  it('shows the courses in the order the API sent them, newest first', async () => {
    render(<CourseList />);
    await screen.findByRole('link', { name: 'Fractions, slowly' });

    expect(rows().map((row) => row.querySelector('h3')?.textContent)).toEqual([
      'Fractions, slowly',
      'Verbs in passing',
    ]);
    expect(within(rowOf('Verbs in passing')).getByText('Published')).toBeInTheDocument();
    expect(within(rowOf('Verbs in passing')).getByText('Intermediate')).toBeInTheDocument();
  });

  it('links a row to the editor that holds it', async () => {
    render(<CourseList />);

    expect(await screen.findByRole('link', { name: 'Fractions, slowly' })).toHaveAttribute(
      'href',
      '/courses/c1/edit',
    );
  });

  it('links a row to the class that is inside it', async () => {
    render(<CourseList />);
    await screen.findAllByRole('listitem');

    expect(within(rowOf('Verbs in passing')).getByRole('link', { name: 'Roster' })).toHaveAttribute(
      'href',
      '/courses/c2/roster',
    );
  });

  it('narrows to one status without asking the API again', async () => {
    render(<CourseList />);
    await screen.findAllByRole('listitem');

    await userEvent.click(screen.getByRole('button', { name: 'Published' }));

    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Verbs in passing' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fractions, slowly' })).not.toBeInTheDocument();
    expect(api.listCourses).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Published' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('invites a teacher with nothing written yet to start', async () => {
    api.listCourses.mockResolvedValue([]);

    render(<CourseList />);

    await userEvent.click(await screen.findByRole('button', { name: /first course/i }));
    expect(push).toHaveBeenCalledWith('/courses/new');
  });

  it('publishes a draft from its row, and paints what the API confirmed', async () => {
    api.publishCourse.mockResolvedValue({ ...DRAFT, status: PUBLISHED.status });

    render(<CourseList />);
    await userEvent.click(
      await screen.findByRole('button', { name: /publish fractions, slowly/i }),
    );

    await waitFor(() => expect(api.publishCourse).toHaveBeenCalledWith('c1'));
    expect(await within(rowOf('Fractions, slowly')).findByText('Published')).toBeInTheDocument();
    expect(notify.success).toHaveBeenCalled();
  });

  it('leaves a refused publish as the draft it still is', async () => {
    api.publishCourse.mockRejectedValue(validationError());

    render(<CourseList />);
    await userEvent.click(
      await screen.findByRole('button', { name: /publish fractions, slowly/i }),
    );

    expect(await within(rowOf('Fractions, slowly')).findByText('Draft')).toBeInTheDocument();
    expect(notify.error).toHaveBeenCalledWith(
      'A course needs a summary and a description before anyone can read it.',
    );
  });

  it('archives a published course so it can be edited again', async () => {
    api.archiveCourse.mockResolvedValue({
      ...PUBLISHED,
      status: { code: 'archived', label: 'Archived' },
    });

    render(<CourseList />);
    await userEvent.click(await screen.findByRole('button', { name: /archive verbs in passing/i }));

    await waitFor(() => expect(api.archiveCourse).toHaveBeenCalledWith('c2'));
    expect(await within(rowOf('Verbs in passing')).findByText('Archived')).toBeInTheDocument();
    // Archived is a full stop, not a step towards publishing again.
    expect(within(rowOf('Verbs in passing')).queryAllByRole('button')).toHaveLength(0);
  });

  it('offers a retry when the list cannot be read', async () => {
    api.listCourses.mockRejectedValueOnce(new Error('The API is unreachable.'));

    render(<CourseList />);

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('link', { name: 'Fractions, slowly' })).toBeInTheDocument();
  });
});
