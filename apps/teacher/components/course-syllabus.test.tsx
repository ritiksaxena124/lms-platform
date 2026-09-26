import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Course, CourseModule } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { CourseSyllabus } from './course-syllabus';

// Hoisted: `vi.mock` calls move above the imports, so a factory may only close over values
// that exist before this file's body runs.
const api = vi.hoisted(() => ({
  readCourse: vi.fn(),
  listModules: vi.fn(),
  createModule: vi.fn(),
  updateModule: vi.fn(),
  reorderModules: vi.fn(),
  deactivateModule: vi.fn(),
}));

vi.mock('@/lib/courses', () => ({ readCourse: api.readCourse }));
vi.mock('@/lib/course-modules', () => api);

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
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

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

const SYLLABUS = [
  moduleOf(),
  moduleOf({ id: 'm2', title: 'Adding fractions', position: 2 }),
  moduleOf({ id: 'm3', title: 'Mixed numbers', position: 3 }),
];

function conflict(message: string): ApiError {
  return new ApiError({ statusCode: 409, code: 'CONFLICT', message });
}

function validationError(field: string, message: string): ApiError {
  return new ApiError({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'Check the highlighted fields.',
    details: { validation: { [field]: [message] } },
  });
}

/** The module rows, in the order they stand on the screen — and only the module rows. */
async function rows() {
  const list = await screen.findByRole('list', { name: /syllabus/i });
  return within(list).getAllByRole('listitem');
}

beforeEach(() => {
  vi.clearAllMocks();
  api.readCourse.mockResolvedValue(course());
  api.listModules.mockResolvedValue(SYLLABUS);
});

describe('CourseSyllabus', () => {
  it('shows the modules in the order the API sent them, numbered as it numbered them', async () => {
    render(<CourseSyllabus courseId="c1" />);

    const list = await rows();
    expect(list.map((row) => row.querySelector('h3')?.textContent)).toEqual([
      'Equivalent fractions',
      'Adding fractions',
      'Mixed numbers',
    ]);
    // The number is the API's `position`, not the row's index: a retired module leaves a gap
    // and the screen has to show the gap rather than smooth it over.
    expect(within(list[1] as HTMLElement).getByText('2')).toBeInTheDocument();
  });

  it('links back to the course the syllabus belongs to', async () => {
    render(<CourseSyllabus courseId="c1" />);

    const link = await screen.findByRole('link', { name: /course details/i });
    expect(link).toHaveAttribute('href', '/courses/c1/edit');
  });

  it('links each module to the lessons inside it', async () => {
    render(<CourseSyllabus courseId="c1" />);

    const list = await rows();
    const into = within(list[1] as HTMLElement).getByRole('link', { name: /lessons/i });
    expect(into).toHaveAttribute('href', '/courses/c1/modules/m2/lessons');
  });

  it('adds a module at the end, and shows the slot the API chose rather than a guessed one', async () => {
    api.createModule.mockResolvedValue(moduleOf({ id: 'm4', title: 'Decimals', position: 4 }));

    render(<CourseSyllabus courseId="c1" />);
    await userEvent.type(await screen.findByLabelText('New module'), 'Decimals');
    await userEvent.click(screen.getByRole('button', { name: /add module/i }));

    await waitFor(() => expect(api.createModule).toHaveBeenCalledWith('c1', { title: 'Decimals' }));
    const list = await rows();
    expect(list).toHaveLength(4);
    expect(within(list[3] as HTMLElement).getByText('4')).toBeInTheDocument();
    expect(screen.getByLabelText('New module')).toHaveValue('');
  });

  it('keeps a title too short next to the box that typed it, and adds nothing', async () => {
    api.createModule.mockRejectedValue(validationError('title', 'At least 3 characters'));

    render(<CourseSyllabus courseId="c1" />);
    await userEvent.type(await screen.findByLabelText('New module'), 'a');
    await userEvent.click(screen.getByRole('button', { name: /add module/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('At least 3 characters');
    expect(await rows()).toHaveLength(3);
  });

  it('renames a module and repaints from what the API says it is now', async () => {
    api.updateModule.mockResolvedValue(
      moduleOf({ id: 'm2', title: 'Adding any two fractions', position: 2 }),
    );

    render(<CourseSyllabus courseId="c1" />);
    const list = await rows();
    await userEvent.click(within(list[1] as HTMLElement).getByRole('button', { name: /edit/i }));

    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Adding any two fractions');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateModule).toHaveBeenCalledWith(
        'c1',
        'm2',
        expect.objectContaining({ title: 'Adding any two fractions' }),
      ),
    );
    const after = await rows();
    expect(after[1]?.querySelector('h3')?.textContent).toBe('Adding any two fractions');
    expect(after[1]?.querySelector('h3')).toBeInTheDocument();
  });

  it('cancels an edit without asking the API anything', async () => {
    render(<CourseSyllabus courseId="c1" />);
    const list = await rows();
    await userEvent.click(within(list[0] as HTMLElement).getByRole('button', { name: /edit/i }));

    await userEvent.clear(await screen.findByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'A title nobody meant to keep');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(api.updateModule).not.toHaveBeenCalled();
    expect((await rows())[0]?.querySelector('h3')?.textContent).toBe('Equivalent fractions');
  });

  it('moves a module down by sending the whole order and repainting from the answer', async () => {
    const moved = [SYLLABUS[1], SYLLABUS[0], SYLLABUS[2]].map((item, index) => ({
      ...item,
      position: index + 1,
    }));
    api.reorderModules.mockResolvedValue(moved);

    render(<CourseSyllabus courseId="c1" />);
    const list = await rows();
    await userEvent.click(
      within(list[0] as HTMLElement).getByRole('button', {
        name: /move equivalent fractions down/i,
      }),
    );

    await waitFor(() => expect(api.reorderModules).toHaveBeenCalledWith('c1', ['m2', 'm1', 'm3']));
    const after = await rows();
    expect(after.map((row) => row.querySelector('h3')?.textContent)).toEqual([
      'Adding fractions',
      'Equivalent fractions',
      'Mixed numbers',
    ]);
  });

  it('has nowhere for the first module to move up, or the last down', async () => {
    render(<CourseSyllabus courseId="c1" />);
    const list = await rows();

    expect(
      within(list[0] as HTMLElement).queryByRole('button', {
        name: /move equivalent fractions up/i,
      }),
    ).toBeNull();
    expect(
      within(list[2] as HTMLElement).queryByRole('button', { name: /move mixed numbers down/i }),
    ).toBeNull();
    // And the middle row can go both ways, so the two above are edges, not missing buttons.
    expect(
      within(list[1] as HTMLElement).getByRole('button', { name: /move adding fractions up/i }),
    ).toBeEnabled();
    expect(
      within(list[1] as HTMLElement).getByRole('button', { name: /move adding fractions down/i }),
    ).toBeEnabled();
  });

  it('takes a module out of the syllabus', async () => {
    api.deactivateModule.mockResolvedValue(SYLLABUS[0] as CourseModule);

    render(<CourseSyllabus courseId="c1" />);
    const list = await rows();
    await userEvent.click(within(list[0] as HTMLElement).getByRole('button', { name: /remove/i }));

    await waitFor(() => expect(api.deactivateModule).toHaveBeenCalledWith('c1', 'm1'));
    const after = await rows();
    expect(after.map((row) => row.querySelector('h3')?.textContent)).toEqual([
      'Adding fractions',
      'Mixed numbers',
    ]);
  });

  it('leaves a readable block standing when the API says it cannot go', async () => {
    api.readCourse.mockResolvedValue(course({ status: { code: 'published', label: 'Published' } }));
    api.deactivateModule.mockRejectedValue(
      conflict(
        'This block still holds a page a student can read. Take those lessons back to a draft first.',
      ),
    );

    render(<CourseSyllabus courseId="c1" />);
    const list = await rows();
    await userEvent.click(within(list[0] as HTMLElement).getByRole('button', { name: /remove/i }));

    expect(notify.error).toHaveBeenCalledWith(
      'This block still holds a page a student can read. Take those lessons back to a draft first.',
    );
    expect(await rows()).toHaveLength(3);
    expect(
      screen.getByText(/a block that still holds a page a student can read/i),
    ).toBeInTheDocument();
  });

  it('says a syllabus is empty in words a teacher can act on', async () => {
    api.listModules.mockResolvedValue([]);

    render(<CourseSyllabus courseId="c1" />);

    expect(await screen.findByText(/no modules yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add module/i })).toBeEnabled();
  });

  it('offers a retry when the syllabus cannot be read', async () => {
    api.listModules.mockRejectedValueOnce(new Error('The API is unreachable.'));

    render(<CourseSyllabus courseId="c1" />);

    const retry = await screen.findByRole('button', { name: /try again/i });
    await userEvent.click(retry);

    await waitFor(() => expect(api.listModules).toHaveBeenCalledTimes(2));
    expect((await rows())[0]?.querySelector('h3')?.textContent).toBe('Equivalent fractions');
  });
});
