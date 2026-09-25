import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Course, CourseModule, Lesson } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { ModuleLessons } from './module-lessons';

// Hoisted: `vi.mock` calls move above the imports, so a factory may only close over values
// that exist before this file's body runs.
const api = vi.hoisted(() => ({
  readCourse: vi.fn(),
  listModules: vi.fn(),
  listLessons: vi.fn(),
  createLesson: vi.fn(),
  updateLesson: vi.fn(),
  reorderLessons: vi.fn(),
  publishLesson: vi.fn(),
  unpublishLesson: vi.fn(),
  deactivateLesson: vi.fn(),
}));

vi.mock('@/lib/courses', () => ({ readCourse: api.readCourse }));
vi.mock('@/lib/course-modules', () => ({ listModules: api.listModules }));
vi.mock('@/lib/lessons', () => api);

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 'c1',
    title: 'Fractions, slowly',
    slug: 'fractions-slowly',
    summary: 'A first pass at the topic.',
    description: 'Start with one pie, end with adding any two fractions.',
    level: { code: 'beginner', label: 'Beginner' },
    status: { code: 'draft', label: 'Draft' },
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

const LIVE = { code: 'published', label: 'Published' };

function moduleOf(overrides: Partial<CourseModule> = {}): CourseModule {
  return {
    id: 'm1',
    courseId: 'c1',
    title: 'Equivalent fractions',
    summary: null,
    description: null,
    position: 1,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

const DRAFT = { code: 'draft', label: 'Draft' };
const PUBLISHED = { code: 'published', label: 'Published' };

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'l1',
    moduleId: 'm1',
    title: 'Halves on a number line',
    body: 'Mark 0, 1/2 and 1 on the same line, then say what you notice.',
    estimatedMinutes: 8,
    position: 1,
    status: DRAFT,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

const LESSONS = [
  lesson(),
  lesson({
    id: 'l2',
    title: 'Quarters on the same line',
    body: null,
    estimatedMinutes: null,
    position: 2,
  }),
  lesson({ id: 'l3', title: 'Comparing unit fractions', position: 3, status: PUBLISHED }),
];

function conflict(message: string): ApiError {
  return new ApiError({ statusCode: 409, code: 'CONFLICT', message });
}

function fieldError(field: string, message: string): ApiError {
  return new ApiError({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'Check the highlighted fields.',
    details: { validation: { [field]: [message] } },
  });
}

/** The lesson rows, in the order they stand on the screen — and only the lesson rows. */
async function rows() {
  const list = await screen.findByRole('list', { name: /lessons/i });
  return within(list).getAllByRole('listitem');
}

function renderScreen() {
  return render(<ModuleLessons courseId="c1" moduleId="m1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.readCourse.mockResolvedValue(course());
  api.listModules.mockResolvedValue([
    moduleOf(),
    moduleOf({ id: 'm2', title: 'Adding fractions', position: 2 }),
  ]);
  api.listLessons.mockResolvedValue(LESSONS);
});

describe('ModuleLessons', () => {
  it('shows the lessons in the order the API sent them, numbered as it numbered them', async () => {
    renderScreen();

    const list = await rows();
    expect(list.map((row) => row.querySelector('h3')?.textContent)).toEqual([
      'Halves on a number line',
      'Quarters on the same line',
      'Comparing unit fractions',
    ]);
    // The API's `position`, not the row index: a retired lesson leaves a gap the screen shows.
    expect(within(list[2] as HTMLElement).getByText('3')).toBeInTheDocument();
  });

  it('names the module these are the lessons of, and links back to the syllabus', async () => {
    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Equivalent fractions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /syllabus/i })).toHaveAttribute(
      'href',
      '/courses/c1/modules',
    );
  });

  it('shows each lesson’s own status, and says so where a lesson has no page written', async () => {
    renderScreen();

    const list = await rows();
    expect(within(list[0] as HTMLElement).getByText('Draft')).toBeInTheDocument();
    expect(within(list[2] as HTMLElement).getByText('Published')).toBeInTheDocument();
    expect(within(list[1] as HTMLElement).getByText(/nothing written yet/i)).toBeInTheDocument();
    // And the estimate is shown when there is one, in words rather than as a bare number.
    expect(within(list[0] as HTMLElement).getByText(/8 min/i)).toBeInTheDocument();
  });

  it('adds a lesson at the end, and shows the slot the API chose rather than a guessed one', async () => {
    api.createLesson.mockResolvedValue(
      lesson({ id: 'l4', title: 'Practising equivalence', body: null, estimatedMinutes: null, position: 4 }),
    );

    renderScreen();
    await userEvent.type(
      await screen.findByLabelText('New lesson'),
      'Practising equivalence',
    );
    await userEvent.click(screen.getByRole('button', { name: /add lesson/i }));

    await waitFor(() =>
      expect(api.createLesson).toHaveBeenCalledWith('m1', { title: 'Practising equivalence' }),
    );
    const list = await rows();
    expect(list).toHaveLength(4);
    expect(within(list[3] as HTMLElement).getByText('4')).toBeInTheDocument();
    expect(screen.getByLabelText('New lesson')).toHaveValue('');
  });

  it('keeps a title too short next to the box that typed it, and adds nothing', async () => {
    api.createLesson.mockRejectedValue(fieldError('title', 'At least 3 characters'));

    renderScreen();
    await userEvent.type(await screen.findByLabelText('New lesson'), 'a');
    await userEvent.click(screen.getByRole('button', { name: /add lesson/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('At least 3 characters');
    expect(await rows()).toHaveLength(3);
  });

  it('writes a page and an estimate, and repaints from what the API says it is now', async () => {
    api.updateLesson.mockResolvedValue(
      lesson({ title: 'Halves, thirds and sixths', body: 'Sixths last.', estimatedMinutes: 12 }),
    );

    renderScreen();
    const list = await rows();
    await userEvent.click(within(list[0] as HTMLElement).getByRole('button', { name: /edit/i }));

    await userEvent.clear(await screen.findByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Halves, thirds and sixths');
    await userEvent.clear(screen.getByLabelText('The page'));
    await userEvent.type(screen.getByLabelText('The page'), 'Sixths last.');
    await userEvent.clear(screen.getByLabelText('Estimated minutes'));
    await userEvent.type(screen.getByLabelText('Estimated minutes'), '12');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateLesson).toHaveBeenCalledWith('m1', 'l1', {
        title: 'Halves, thirds and sixths',
        body: 'Sixths last.',
        estimatedMinutes: 12,
      }),
    );
    const after = await rows();
    expect(after[0]?.querySelector('h3')?.textContent).toBe('Halves, thirds and sixths');
    expect(within(after[0] as HTMLElement).getByText(/12 min/i)).toBeInTheDocument();
  });

  it('clears an estimate with an explicit null rather than leaving it out', async () => {
    api.updateLesson.mockResolvedValue(lesson({ estimatedMinutes: null }));

    renderScreen();
    const list = await rows();
    await userEvent.click(within(list[0] as HTMLElement).getByRole('button', { name: /edit/i }));

    await userEvent.clear(await screen.findByLabelText('Estimated minutes'));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateLesson).toHaveBeenCalledWith(
        'm1',
        'l1',
        expect.objectContaining({ estimatedMinutes: null }),
      ),
    );
  });

  it('cancels an edit without asking the API anything', async () => {
    renderScreen();
    const list = await rows();
    await userEvent.click(within(list[0] as HTMLElement).getByRole('button', { name: /edit/i }));

    await userEvent.clear(await screen.findByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'A title nobody meant to keep');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(api.updateLesson).not.toHaveBeenCalled();
    expect((await rows())[0]?.querySelector('h3')?.textContent).toBe('Halves on a number line');
  });

  it('publishes a page that has something written in it', async () => {
    api.publishLesson.mockResolvedValue(lesson({ status: PUBLISHED }));

    renderScreen();
    const list = await rows();
    await userEvent.click(
      within(list[0] as HTMLElement).getByRole('button', { name: /publish halves on a number line/i }),
    );

    await waitFor(() => expect(api.publishLesson).toHaveBeenCalledWith('m1', 'l1'));
    expect(within((await rows())[0] as HTMLElement).getByText('Published')).toBeInTheDocument();
  });

  it('shows the API’s reason when it refuses to publish an empty page', async () => {
    api.publishLesson.mockRejectedValue(fieldError('body', 'Write the page before publishing it.'));

    renderScreen();
    const list = await rows();
    await userEvent.click(
      within(list[1] as HTMLElement).getByRole('button', { name: /publish quarters on the same line/i }),
    );

    await waitFor(() => expect(api.publishLesson).toHaveBeenCalledWith('m1', 'l2'));
    expect(notify.error).toHaveBeenCalledWith('Write the page before publishing it.');
    expect(within((await rows())[1] as HTMLElement).getByText('Draft')).toBeInTheDocument();
  });

  it('takes a published page back to a draft, which a live course allows', async () => {
    api.readCourse.mockResolvedValue(course({ status: LIVE }));
    api.unpublishLesson.mockResolvedValue(lesson({ id: 'l3', status: DRAFT }));

    renderScreen();
    const list = await rows();
    await userEvent.click(
      within(list[2] as HTMLElement).getByRole('button', { name: /unpublish comparing unit fractions/i }),
    );

    await waitFor(() => expect(api.unpublishLesson).toHaveBeenCalledWith('m1', 'l3'));
    expect(within((await rows())[2] as HTMLElement).getByText('Draft')).toBeInTheDocument();
  });

  it('moves a lesson to another module as a request of its own, and drops it from this list', async () => {
    api.updateLesson.mockResolvedValue(lesson({ moduleId: 'm2', position: 1 }));

    renderScreen();
    const list = await rows();
    await userEvent.selectOptions(
      within(list[0] as HTMLElement).getByLabelText(/move halves on a number line to another module/i),
      'm2',
    );

    await waitFor(() =>
      expect(api.updateLesson).toHaveBeenCalledWith('m1', 'l1', { moduleId: 'm2' }),
    );
    const after = await rows();
    expect(after.map((row) => row.querySelector('h3')?.textContent)).toEqual([
      'Quarters on the same line',
      'Comparing unit fractions',
    ]);
    expect(notify.success).toHaveBeenCalledWith('Moved to Adding fractions');
  });

  it('moves a lesson up by sending the whole order and repainting from the answer', async () => {
    api.reorderLessons.mockResolvedValue(
      [LESSONS[1], LESSONS[0], LESSONS[2]].map((item, index) => ({
        ...item,
        position: index + 1,
      })),
    );

    renderScreen();
    const list = await rows();
    await userEvent.click(
      within(list[1] as HTMLElement).getByRole('button', {
        name: /move quarters on the same line up/i,
      }),
    );

    await waitFor(() => expect(api.reorderLessons).toHaveBeenCalledWith('m1', ['l2', 'l1', 'l3']));
    const after = await rows();
    expect(after.map((row) => row.querySelector('h3')?.textContent)).toEqual([
      'Quarters on the same line',
      'Halves on a number line',
      'Comparing unit fractions',
    ]);
  });

  it('has nowhere for the first lesson to move up, or the last down', async () => {
    renderScreen();
    const list = await rows();

    expect(
      within(list[0] as HTMLElement).queryByRole('button', {
        name: /move halves on a number line up/i,
      }),
    ).toBeNull();
    expect(
      within(list[2] as HTMLElement).queryByRole('button', {
        name: /move comparing unit fractions down/i,
      }),
    ).toBeNull();
  });

  it('takes a lesson out under a draft course', async () => {
    api.deactivateLesson.mockResolvedValue(lesson());

    renderScreen();
    const list = await rows();
    await userEvent.click(within(list[0] as HTMLElement).getByRole('button', { name: /remove/i }));

    await waitFor(() => expect(api.deactivateLesson).toHaveBeenCalledWith('m1', 'l1'));
    expect((await rows()).map((row) => row.querySelector('h3')?.textContent)).toEqual([
      'Quarters on the same line',
      'Comparing unit fractions',
    ]);
  });

  it('leaves a lesson standing when the live course refuses to lose one', async () => {
    api.readCourse.mockResolvedValue(course({ status: LIVE }));
    api.deactivateLesson.mockRejectedValue(
      conflict(
        'Take the lesson back to a draft to hide it, or archive the course to take it out of the syllabus.',
      ),
    );

    renderScreen();
    const list = await rows();
    await userEvent.click(within(list[0] as HTMLElement).getByRole('button', { name: /remove/i }));

    expect(notify.error).toHaveBeenCalledWith(
      'Take the lesson back to a draft to hide it, or archive the course to take it out of the syllabus.',
    );
    expect(await rows()).toHaveLength(3);
    expect(screen.getByText(/unpublish it instead of removing it/i)).toBeInTheDocument();
  });

  it('says a module has no lessons in words a teacher can act on', async () => {
    api.listLessons.mockResolvedValue([]);

    renderScreen();

    expect(await screen.findByText(/no lessons yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add lesson/i })).toBeEnabled();
  });

  it('offers a retry when the lessons cannot be read', async () => {
    api.listLessons.mockRejectedValueOnce(new Error('The API is unreachable.'));

    renderScreen();

    const retry = await screen.findByRole('button', { name: /try again/i });
    await userEvent.click(retry);

    await waitFor(() => expect(api.listLessons).toHaveBeenCalledTimes(2));
    expect((await rows())[0]?.querySelector('h3')?.textContent).toBe('Halves on a number line');
  });
});
