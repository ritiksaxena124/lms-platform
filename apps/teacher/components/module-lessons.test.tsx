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

// The recording block reads its own state per lesson, so the screen's test only needs it to
// answer without a file on the page.
const assets = vi.hoisted(() => ({
  standingLessonAsset: vi.fn(),
  attachLessonAsset: vi.fn(),
  lessonAssetBytes: vi.fn(),
}));

vi.mock('@/lib/lesson-assets', () => assets);

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
    price: null,
    demoBookingsEnabled: false,
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
    // After the spread because a fixture that said nothing about the flag is a locked page,
    // and `Partial<Lesson>` would otherwise make "not mentioned" read as "unknown".
    isFreePreview: overrides.isFreePreview ?? false,
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
  assets.standingLessonAsset.mockResolvedValue(null);
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

    expect(
      await screen.findByRole('heading', { name: 'Equivalent fractions' }),
    ).toBeInTheDocument();
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
      lesson({
        id: 'l4',
        title: 'Practising equivalence',
        body: null,
        estimatedMinutes: null,
        position: 4,
      }),
    );

    renderScreen();
    await userEvent.type(await screen.findByLabelText('New lesson'), 'Practising equivalence');
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
        // Whole, every time: a save that left the flag out could not tell "unchanged" from
        // "I unticked it", and the box would be unable to close a page.
        isFreePreview: false,
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
      within(list[0] as HTMLElement).getByRole('button', {
        name: /publish halves on a number line/i,
      }),
    );

    await waitFor(() => expect(api.publishLesson).toHaveBeenCalledWith('m1', 'l1'));
    expect(within((await rows())[0] as HTMLElement).getByText('Published')).toBeInTheDocument();
  });

  it('shows the API’s reason when it refuses to publish an empty page', async () => {
    api.publishLesson.mockRejectedValue(fieldError('body', 'Write the page before publishing it.'));

    renderScreen();
    const list = await rows();
    await userEvent.click(
      within(list[1] as HTMLElement).getByRole('button', {
        name: /publish quarters on the same line/i,
      }),
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
      within(list[2] as HTMLElement).getByRole('button', {
        name: /unpublish comparing unit fractions/i,
      }),
    );

    await waitFor(() => expect(api.unpublishLesson).toHaveBeenCalledWith('m1', 'l3'));
    expect(within((await rows())[2] as HTMLElement).getByText('Draft')).toBeInTheDocument();
  });

  it('moves a lesson to another module as a request of its own, and drops it from this list', async () => {
    api.updateLesson.mockResolvedValue(lesson({ moduleId: 'm2', position: 1 }));

    renderScreen();
    const list = await rows();
    await userEvent.selectOptions(
      within(list[0] as HTMLElement).getByLabelText(
        /move halves on a number line to another module/i,
      ),
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

  it('leaves a readable page standing when the API says it cannot go', async () => {
    api.readCourse.mockResolvedValue(course({ status: LIVE }));
    api.deactivateLesson.mockRejectedValue(
      conflict(
        'A page a student can read goes back to a draft first — unpublish it, then take it out of the syllabus.',
      ),
    );

    renderScreen();
    const list = await rows();
    await userEvent.click(within(list[0] as HTMLElement).getByRole('button', { name: /remove/i }));

    expect(notify.error).toHaveBeenCalledWith(
      'A page a student can read goes back to a draft first — unpublish it, then take it out of the syllabus.',
    );
    expect(await rows()).toHaveLength(3);
    expect(
      screen.getByText(/a published page is the one that has to go back to a draft/i),
    ).toBeInTheDocument();
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

  it('says which pages a stranger may already read, and which ones are only planned', async () => {
    api.listLessons.mockResolvedValue([
      lesson({ id: 'l1', status: PUBLISHED, isFreePreview: true }),
      lesson({ id: 'l2', position: 2, isFreePreview: true }),
      lesson({ id: 'l3', position: 3 }),
    ]);

    renderScreen();
    const list = await rows();

    // The mark and the page's own flag are two different decisions, and a teacher who set one
    // without the other needs to see that: a draft marked free is a plan for a sample, not a
    // page anybody outside the course can read.
    expect(within(list[0] as HTMLElement).getByText('Free to read')).toBeInTheDocument();
    expect(within(list[1] as HTMLElement).getByText(/free when published/i)).toBeInTheDocument();
    expect(within(list[2] as HTMLElement).queryByText(/free/i)).not.toBeInTheDocument();
  });

  it('opens the free box from the row it edits, not from wherever the form last was', async () => {
    api.listLessons.mockResolvedValue([
      lesson({ id: 'l1', status: PUBLISHED, isFreePreview: true }),
      lesson({ id: 'l2', position: 2 }),
    ]);

    renderScreen();
    const list = await rows();

    await userEvent.click(within(list[0] as HTMLElement).getByRole('button', { name: /edit/i }));
    expect(await screen.findByLabelText('Free to read')).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await userEvent.click(
      within((await rows())[1] as HTMLElement).getByRole('button', { name: /edit/i }),
    );
    expect(await screen.findByLabelText('Free to read')).not.toBeChecked();
  });

  it('sends the mark with the rest of the page and repaints the row from the answer', async () => {
    api.updateLesson.mockResolvedValue(
      lesson({ id: 'l3', position: 3, status: PUBLISHED, isFreePreview: true }),
    );

    renderScreen();
    const list = await rows();
    await userEvent.click(
      within(list[2] as HTMLElement).getByRole('button', {
        name: /edit comparing unit fractions/i,
      }),
    );

    await userEvent.click(await screen.findByLabelText('Free to read'));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateLesson).toHaveBeenCalledWith(
        'm1',
        'l3',
        expect.objectContaining({ isFreePreview: true }),
      ),
    );
    expect(within((await rows())[2] as HTMLElement).getByText('Free to read')).toBeInTheDocument();
  });

  it('closes a page again when the box is cleared', async () => {
    api.listLessons.mockResolvedValue([
      lesson({ id: 'l1', status: PUBLISHED, isFreePreview: true }),
    ]);
    api.updateLesson.mockResolvedValue(
      lesson({ id: 'l1', status: PUBLISHED, isFreePreview: false }),
    );

    renderScreen();
    const before = await rows();
    await userEvent.click(
      within(before[0] as HTMLElement).getByRole('button', {
        name: /edit halves on a number line/i,
      }),
    );

    await userEvent.click(await screen.findByLabelText('Free to read'));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateLesson).toHaveBeenCalledWith(
        'm1',
        'l1',
        expect.objectContaining({ isFreePreview: false }),
      ),
    );
    expect(within((await rows())[0] as HTMLElement).queryByText(/free/i)).not.toBeInTheDocument();
  });

  it('carries that page’s recording in the panel that edits it, and nowhere else', async () => {
    renderScreen();
    expect(screen.queryByText(/recording/i)).not.toBeInTheDocument();

    const before = await rows();
    await userEvent.click(
      within(before[0] as HTMLElement).getByRole('button', {
        name: /edit halves on a number line/i,
      }),
    );

    expect(await screen.findByText('The recording')).toBeInTheDocument();
    expect(assets.standingLessonAsset).toHaveBeenCalledWith('m1', 'l1');

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByText('The recording')).not.toBeInTheDocument();
  });
});
