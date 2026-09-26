import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogFreeLesson } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { FreeLesson } from './free-lesson';

const api = vi.hoisted(() => ({
  readFreeLesson: vi.fn(),
}));

vi.mock('@/lib/catalog', () => api);

function page(overrides: Partial<CatalogFreeLesson> = {}): CatalogFreeLesson {
  return {
    id: 'l2',
    title: 'Sum of n terms',
    body: 'Write the series out twice.\nThen add the two lines and watch the middle vanish.',
    estimatedMinutes: 12,
    position: 2,
    isFreePreview: true,
    updatedAt: '2026-09-25T00:00:00.000Z',
    module: { id: 'm1', title: 'Arithmetic progressions', position: 1 },
    course: {
      id: 'b2a1',
      slug: 'algebra-for-the-cbse-boards',
      title: 'Algebra for the CBSE boards',
    },
    ...overrides,
  };
}

/** The API's one answer for "locked", "withdrawn" and "never written", which is the answer
 * this screen has to keep. */
const unreadable = () =>
  new ApiError({ statusCode: 404, code: 'NOT_FOUND', message: 'We cannot find that page.' });

beforeEach(() => {
  api.readFreeLesson.mockResolvedValue(page());
});

describe('FreeLesson', () => {
  it('hands a stranger the page a teacher left open', async () => {
    render(<FreeLesson courseId="b2a1" lessonId="l2" />);

    await screen.findByRole('heading', { name: 'Sum of n terms' });
    expect(screen.getByText(/watch the middle vanish/i)).toBeInTheDocument();
  });

  it('keeps the writing as it was written, line breaks included', async () => {
    const { container } = render(<FreeLesson courseId="b2a1" lessonId="l2" />);
    await screen.findByText(/Write the series out twice/);

    // Tailwind is not compiled in a unit test, so the class is what is checkable; the point is
    // that a teacher's paragraphs survived the trip through the API.
    const prose = container.querySelector('[data-lesson-body]');
    expect(prose?.className).toContain('whitespace-pre-wrap');
    expect(prose?.textContent).toContain('\nThen add');
  });

  it('says where the page sits and links back to the outline it came from', async () => {
    render(<FreeLesson courseId="b2a1" lessonId="l2" />);
    await screen.findByRole('heading', { name: 'Sum of n terms' });

    expect(screen.getByText(/Arithmetic progressions/i)).toBeInTheDocument();

    // A visitor who arrived at one free page from a shared link needs the way back to the
    // course, and the syllabus is the only thing that says what comes next.
    const breadcrumb = screen.getByRole('link', { name: /Algebra for the CBSE boards/i });
    expect(breadcrumb.getAttribute('href')).toBe('/courses/b2a1');
    expect(screen.getByRole('link', { name: /rest of this course/i }).getAttribute('href')).toBe(
      '/courses/b2a1',
    );
  });

  it('shows the teacher’s estimate beside the page, and says nothing when there was none', async () => {
    render(<FreeLesson courseId="b2a1" lessonId="l2" />);
    await screen.findByText(/12 min/i);

    api.readFreeLesson.mockResolvedValue(page({ estimatedMinutes: null }));
    render(<FreeLesson courseId="b2a1" lessonId="l9" />);

    expect(await screen.findByText(/not timed/i)).toBeInTheDocument();
  });

  it('says so when the page is open but empty', async () => {
    api.readFreeLesson.mockResolvedValue(page({ body: null }));
    render(<FreeLesson courseId="b2a1" lessonId="l2" />);

    // The flag and the writing are two separate acts, so this is a real state: an open door
    // onto a blank page. Saying "nothing here yet" is kinder than an empty box.
    expect(await screen.findByText(/nothing written on it yet/i)).toBeInTheDocument();
  });

  it('answers a page it cannot open the way it answers one never written', async () => {
    api.readFreeLesson.mockRejectedValue(unreadable());
    render(<FreeLesson courseId="b2a1" lessonId="l2" />);

    await screen.findByText(/not here/i);
    // No "this page is locked", no "ask the teacher to open it": the API refused to make that
    // distinction and a screen that did would be a list of what to enroll for.
    expect(screen.queryByText(/locked|draft|withdrawn/i)).not.toBeInTheDocument();
    // The outline is still readable, so the way back is the way back — even when the address
    // itself may be the mistake.
    expect(screen.getByRole('link', { name: /back to the course/i }).getAttribute('href')).toBe(
      '/courses/b2a1',
    );
  });

  it('offers a retry when the request failed rather than the page', async () => {
    api.readFreeLesson
      .mockRejectedValueOnce(
        new ApiError({ statusCode: 500, code: 'INTERNAL', message: 'Try again shortly.' }),
      )
      .mockResolvedValue(page());
    render(<FreeLesson courseId="b2a1" lessonId="l2" />);

    const attemptsBeforeClick = api.readFreeLesson.mock.calls.length;
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    await waitFor(() =>
      expect(api.readFreeLesson.mock.calls.length).toBe(attemptsBeforeClick + 1),
    );
    await screen.findByRole('heading', { name: 'Sum of n terms' });
  });

  it('says the page is arriving before it arrives', async () => {
    api.readFreeLesson.mockReturnValue(new Promise(() => {}));
    render(<FreeLesson courseId="b2a1" lessonId="l2" />);

    expect(await screen.findByText(/loading this page/i)).toBeInTheDocument();
  });
});
