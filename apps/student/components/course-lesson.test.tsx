import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, CatalogCourseDetail, CatalogLesson, CatalogLessonPage } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { CourseLesson } from './course-lesson';

const api = vi.hoisted(() => ({
  readLessonPage: vi.fn(),
  readCatalogCourse: vi.fn(),
  lessonVideoBytes: vi.fn(),
}));
const session = vi.hoisted(() => ({
  value: { status: 'signed-in' as string, user: null as AuthUser | null },
}));

vi.mock('@/lib/catalog', () => api);
vi.mock('./session-provider', () => ({ useSession: () => session.value }));

/** Whose page this is being read as. The catalog answers a different question to a member than to
 * a stranger, so the screen has to know which one it is asking. */
const ROHAN: AuthUser = {
  id: 'u1',
  email: 'student@example.test',
  fullName: 'Rohan Mehta',
  role: 'student',
  status: 'active',
  timezone: 'Asia/Kolkata',
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-09-25T00:00:00.000Z',
};

function page(overrides: Partial<CatalogLessonPage> = {}): CatalogLessonPage {
  return {
    id: 'l2',
    title: 'Sum of n terms',
    body: 'Write the series out twice.\nThen add the two lines and watch the middle vanish.',
    estimatedMinutes: 12,
    position: 2,
    isFreePreview: true,
    // The ordinary case: most pages of a course are written rather than filmed.
    video: null,
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

/** One row of the syllabus as the outline endpoint sends it. The pager's whole vocabulary is
 * these two fields — where the row sits, and whether this reader may open it. */
function row(id: string, title: string, position: number, isReadable = true): CatalogLesson {
  return {
    id,
    title,
    position,
    estimatedMinutes: 10,
    isFreePreview: false,
    isReadable,
  };
}

/** The course the fixture page belongs to: two modules, three pages then two. */
function outline(overrides: Partial<CatalogCourseDetail> = {}): CatalogCourseDetail {
  return {
    id: 'b2a1',
    slug: 'algebra-for-the-cbse-boards',
    title: 'Algebra for the CBSE boards',
    summary: null,
    description: null,
    level: { code: 'cbse-secondary', label: 'CBSE secondary' },
    teacher: { displayName: 'Rohan Mehta' },
    price: null,
    modules: [
      {
        id: 'm1',
        title: 'Arithmetic progressions',
        summary: null,
        position: 1,
        lessons: [
          row('l1', 'Why the denominator stays put', 1),
          row('l2', 'Sum of n terms', 2),
          row('l3', 'Where the middle goes', 3),
        ],
      },
      {
        id: 'm2',
        title: 'Quadratics',
        summary: null,
        position: 2,
        lessons: [row('l4', 'Factoring by grouping', 1), row('l5', 'The formula, carefully', 2)],
      },
    ],
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

/** The API's one answer for "locked", "withdrawn" and "never written", which is the answer
 * this screen has to keep. */
const unreadable = () =>
  new ApiError({ statusCode: 404, code: 'NOT_FOUND', message: 'We cannot find that page.' });

beforeEach(() => {
  session.value = { status: 'signed-in', user: ROHAN };
  api.readLessonPage.mockReset().mockResolvedValue(page());
  api.readCatalogCourse.mockReset().mockResolvedValue(outline());
  api.lessonVideoBytes.mockReset().mockResolvedValue(new Blob(['frame'], { type: 'video/mp4' }));
});

describe('CourseLesson', () => {
  it('hands a stranger the page a teacher left open', async () => {
    render(<CourseLesson courseId="b2a1" lessonId="l2" />);

    await screen.findByRole('heading', { name: 'Sum of n terms' });
    expect(screen.getByText(/watch the middle vanish/i)).toBeInTheDocument();
    expect(screen.getByText('Free to read')).toBeInTheDocument();
  });

  it('offers the recording the page said it carries, and asks for no bytes yet', async () => {
    api.readLessonPage.mockResolvedValue(
      page({ video: { displayName: 'adding-halves.mp4', bytes: 1_048_576 } }),
    );
    render(<CourseLesson courseId="b2a1" lessonId="l2" />);

    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByText('adding-halves.mp4')).toBeInTheDocument();
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
    // The whole point of the page naming its own file: a student on a phone connection does not
    // download a lesson to find out whether the lesson is there.
    expect(api.lessonVideoBytes).not.toHaveBeenCalled();
  });

  it('puts the recording above the writing it belongs to', async () => {
    api.readLessonPage.mockResolvedValue(
      page({ video: { displayName: 'adding-halves.mp4', bytes: 1_048_576 } }),
    );
    const { container } = render(<CourseLesson courseId="b2a1" lessonId="l2" />);
    await screen.findByRole('button', { name: 'Play' });

    const block = screen.getByRole('button', { name: 'Play' }).closest('section');
    const prose = container.querySelector('[data-lesson-body]');
    expect(block).not.toBeNull();
    expect(prose).not.toBeNull();
    // The video is the class and the text is what the teacher wrote around it. A page that put
    // the recording under the prose would be a page nobody finds.
    expect(block!.compareDocumentPosition(prose!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no player for a page that carries no recording', async () => {
    render(<CourseLesson courseId="b2a1" lessonId="l2" />);

    await screen.findByRole('heading', { name: 'Sum of n terms' });
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.getByText(/watch the middle vanish/i)).toBeInTheDocument();
  });

  it('says nothing about enrolling to somebody reading as a member', async () => {
    // The same page, arrived at through the other door. `isFreePreview` is the teacher's word
    // about the page, so it is the only thing that may say how the reader got in — and a
    // student already inside is not being pitched at.
    api.readLessonPage.mockResolvedValue(page({ isFreePreview: false }));
    render(<CourseLesson courseId="b2a1" lessonId="l1" />);

    await screen.findByRole('heading', { name: 'Sum of n terms' });
    expect(screen.queryByText('Free to read')).not.toBeInTheDocument();
    expect(screen.queryByText(/enrolling is for/i)).not.toBeInTheDocument();
    expect(screen.getByText(/you hold a place in this course/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the syllabus/i })).toHaveAttribute(
      'href',
      '/courses/b2a1',
    );
  });

  it('keeps the writing as it was written, line breaks included', async () => {
    const { container } = render(<CourseLesson courseId="b2a1" lessonId="l2" />);
    await screen.findByText(/Write the series out twice/);

    // Tailwind is not compiled in a unit test, so the class is what is checkable; the point is
    // that a teacher's paragraphs survived the trip through the API.
    const prose = container.querySelector('[data-lesson-body]');
    expect(prose?.className).toContain('whitespace-pre-wrap');
    expect(prose?.textContent).toContain('\nThen add');
  });

  it('says where the page sits and links back to the outline it came from', async () => {
    render(<CourseLesson courseId="b2a1" lessonId="l2" />);
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
    render(<CourseLesson courseId="b2a1" lessonId="l2" />);
    await screen.findByText(/12 min/i);

    api.readLessonPage.mockResolvedValue(page({ estimatedMinutes: null }));
    render(<CourseLesson courseId="b2a1" lessonId="l9" />);

    expect(await screen.findByText(/not timed/i)).toBeInTheDocument();
  });

  it('says so when the page is open but empty', async () => {
    api.readLessonPage.mockResolvedValue(page({ body: null }));
    render(<CourseLesson courseId="b2a1" lessonId="l2" />);

    // The flag and the writing are two separate acts, so this is a real state: an open door
    // onto a blank page. Saying "nothing here yet" is kinder than an empty box.
    expect(await screen.findByText(/nothing written on it yet/i)).toBeInTheDocument();
  });

  it('answers a page it cannot open the way it answers one never written', async () => {
    api.readLessonPage.mockRejectedValue(unreadable());
    render(<CourseLesson courseId="b2a1" lessonId="l2" />);

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
    api.readLessonPage
      .mockRejectedValueOnce(
        new ApiError({ statusCode: 500, code: 'INTERNAL', message: 'Try again shortly.' }),
      )
      .mockResolvedValue(page());
    render(<CourseLesson courseId="b2a1" lessonId="l2" />);

    const attemptsBeforeClick = api.readLessonPage.mock.calls.length;
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    await waitFor(() => expect(api.readLessonPage.mock.calls.length).toBe(attemptsBeforeClick + 1));
    await screen.findByRole('heading', { name: 'Sum of n terms' });
  });

  it('says the page is arriving before it arrives', async () => {
    api.readLessonPage.mockReturnValue(new Promise(() => {}));
    render(<CourseLesson courseId="b2a1" lessonId="l2" />);

    expect(await screen.findByText(/loading this page/i)).toBeInTheDocument();
  });

  it('waits for the session before it asks who may open the page', async () => {
    // The catalog answers this request differently depending on who sends it, and the browser
    // sends the refresh cookie whether or not this portal has worked out who is logged in yet.
    // So the answer the screen paints is only trustworthy once the boot read has landed.
    session.value = { status: 'bootstrapping', user: null };
    const { rerender } = render(<CourseLesson courseId="b2a1" lessonId="l2" />);

    expect(api.readLessonPage).not.toHaveBeenCalled();
    expect(screen.getByText(/loading this page/i)).toBeInTheDocument();

    session.value = { status: 'signed-in', user: ROHAN };
    rerender(<CourseLesson courseId="b2a1" lessonId="l2" />);

    await screen.findByRole('heading', { name: 'Sum of n terms' });
    // One read, not one for the stranger and a second under it.
    expect(api.readLessonPage).toHaveBeenCalledTimes(1);
  });

  it('does not keep a stranger’s refusal under a student who has just signed in', async () => {
    // The shared link that 404s for a visitor is the page a member was invited to read. A key
    // that left the reader out would hold onto the first answer for the rest of the visit.
    session.value = { status: 'signed-out', user: null };
    api.readLessonPage.mockRejectedValueOnce(unreadable());
    const { rerender } = render(<CourseLesson courseId="b2a1" lessonId="l2" />);

    await screen.findByText(/not here/i);
    expect(api.readLessonPage).toHaveBeenCalledTimes(1);

    session.value = { status: 'signed-in', user: ROHAN };
    api.readLessonPage.mockResolvedValueOnce(page({ isFreePreview: false }));
    rerender(<CourseLesson courseId="b2a1" lessonId="l2" />);

    await screen.findByRole('heading', { name: 'Sum of n terms' });
    expect(api.readLessonPage).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/you hold a place in this course/i)).toBeInTheDocument();
  });

  describe('the pager', () => {
    it('links the page before this one and the page after it', async () => {
      render(<CourseLesson courseId="b2a1" lessonId="l2" />);

      const previous = await screen.findByRole('link', { name: /why the denominator stays put/i });
      expect(previous.getAttribute('href')).toBe('/courses/b2a1/lessons/l1');
      expect(
        screen.getByRole('link', { name: /where the middle goes/i }).getAttribute('href'),
      ).toBe('/courses/b2a1/lessons/l3');
    });

    it('follows the positions, not the order the rows happened to arrive in', async () => {
      // The second module listed first, and its pages shuffled: what a reader walks is module
      // position then page position, which is the numbering printed in the header.
      api.readLessonPage.mockResolvedValue(page({ id: 'l3', position: 3 }));
      api.readCatalogCourse.mockResolvedValue(
        outline({
          modules: [
            {
              id: 'm2',
              title: 'Quadratics',
              summary: null,
              position: 2,
              lessons: [
                row('l5', 'The formula, carefully', 2),
                row('l4', 'Factoring by grouping', 1),
              ],
            },
            {
              id: 'm1',
              title: 'Arithmetic progressions',
              summary: null,
              position: 1,
              lessons: [
                row('l2', 'Sum of n terms', 2),
                row('l3', 'Where the middle goes', 3),
                row('l1', 'Why the denominator stays put', 1),
              ],
            },
          ],
        }),
      );
      render(<CourseLesson courseId="b2a1" lessonId="l3" />);

      expect(await screen.findByRole('link', { name: /sum of n terms/i })).toHaveAttribute(
        'href',
        '/courses/b2a1/lessons/l2',
      );
      // Over the module boundary, onto the first page of the next one.
      expect(screen.getByRole('link', { name: /factoring by grouping/i })).toHaveAttribute(
        'href',
        '/courses/b2a1/lessons/l4',
      );
      expect(
        screen.queryByRole('link', { name: /the formula, carefully/i }),
      ).not.toBeInTheDocument();
    });

    it('does not offer a locked neighbour as a link', async () => {
      // The reader is a visitor: the page after this one is behind a place in the course. The
      // outline already prints that title without a link, so saying the same thing here adds
      // nothing the API did not already show — but a door that is not one must not look like a
      // door.
      api.readCatalogCourse.mockResolvedValue(
        outline({
          modules: [
            {
              id: 'm1',
              title: 'Arithmetic progressions',
              summary: null,
              position: 1,
              lessons: [
                row('l1', 'Why the denominator stays put', 1),
                row('l2', 'Sum of n terms', 2),
                row('l3', 'Where the middle goes', 3, false),
              ],
            },
          ],
        }),
      );
      render(<CourseLesson courseId="b2a1" lessonId="l2" />);

      await screen.findByRole('link', { name: /why the denominator stays put/i });
      expect(
        screen.queryByRole('link', { name: /where the middle goes/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Where the middle goes')).toBeInTheDocument();
    });

    it('says the first page is the first, and the last is the last', async () => {
      api.readLessonPage.mockResolvedValue(page({ id: 'l1', position: 1 }));
      const first = render(<CourseLesson courseId="b2a1" lessonId="l1" />);

      expect(await screen.findByRole('link', { name: /sum of n terms/i })).toBeInTheDocument();
      expect(screen.getByText(/start of the course/i)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /previous/i })).not.toBeInTheDocument();

      first.unmount();
      api.readLessonPage.mockResolvedValue(
        page({ id: 'l5', position: 2, module: { id: 'm2', title: 'Quadratics', position: 2 } }),
      );
      render(<CourseLesson courseId="b2a1" lessonId="l5" />);

      // The last page keeps its previous one and loses its next: what is left to say is that
      // there is nothing after this, not a link that goes nowhere.
      expect(
        await screen.findByRole('link', { name: /factoring by grouping/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/end of the course/i)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /sum of n terms/i })).not.toBeInTheDocument();
    });

    it('draws no pager at all for a course of one page', async () => {
      api.readCatalogCourse.mockResolvedValue(
        outline({
          modules: [
            {
              id: 'm1',
              title: 'Arithmetic progressions',
              summary: null,
              position: 1,
              lessons: [row('l2', 'Sum of n terms', 2)],
            },
          ],
        }),
      );
      render(<CourseLesson courseId="b2a1" lessonId="l2" />);

      await screen.findByRole('heading', { name: 'Sum of n terms' });
      await waitFor(() => expect(api.readCatalogCourse).toHaveBeenCalledTimes(1));

      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
      expect(screen.queryByText(/start of the course|end of the course/i)).not.toBeInTheDocument();
    });

    it('hands over the page even when the outline does not arrive', async () => {
      // The body is the product; the pager is a convenience. A failed second read may not take
      // the first one's answer down with it, and may not show an error over a page that opened.
      api.readCatalogCourse.mockRejectedValue(
        new ApiError({ statusCode: 500, code: 'INTERNAL', message: 'Try again shortly.' }),
      );
      render(<CourseLesson courseId="b2a1" lessonId="l2" />);

      await screen.findByRole('heading', { name: 'Sum of n terms' });
      await waitFor(() => expect(api.readCatalogCourse).toHaveBeenCalledTimes(1));

      expect(screen.getByText(/watch the middle vanish/i)).toBeInTheDocument();
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
      expect(screen.queryByText(/did not load|try again/i)).not.toBeInTheDocument();
    });

    it('asks for the outline once and keeps it while the reader moves along the pager', async () => {
      const { rerender } = render(<CourseLesson courseId="b2a1" lessonId="l2" />);
      await screen.findByRole('link', { name: /where the middle goes/i });

      api.readLessonPage.mockResolvedValue(page({ id: 'l3', position: 3 }));
      rerender(<CourseLesson courseId="b2a1" lessonId="l3" />);
      await screen.findByRole('link', { name: /factoring by grouping/i });

      // The syllabus does not change as one walks it, so the second page costs one read less —
      // while the page itself is a fresh question, answered twice.
      expect(api.readCatalogCourse).toHaveBeenCalledTimes(1);
      expect(api.readLessonPage).toHaveBeenCalledTimes(2);
    });
  });
});
