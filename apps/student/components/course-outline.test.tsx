import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, CatalogCourseDetail, Enrollment } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { CourseOutline } from './course-outline';

const api = vi.hoisted(() => ({
  readCatalogCourse: vi.fn(),
}));

const roster = vi.hoisted(() => ({
  myPlaces: vi.fn(),
  heldPlaces: vi.fn(),
  takePlace: vi.fn(),
}));

const session = vi.hoisted(() => ({
  value: { status: 'signed-out' as string, user: null as AuthUser | null },
}));

vi.mock('@/lib/catalog', () => api);
vi.mock('@/lib/enrollments', () => roster);
vi.mock('./session-provider', () => ({ useSession: () => session.value }));

const SAM: AuthUser = {
  id: 'u1',
  email: 'sam@example.test',
  fullName: 'Sam Iyer',
  role: 'student',
  status: 'active',
  timezone: 'UTC',
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-09-25T00:00:00.000Z',
};

/** The session the member-shaped fixtures describe: signed in, and holding a place in `b2a1`.
 * An outline that says every row is open arrives together with the roster that explains it —
 * the two are one reader's answer, not two things a test may mix freely. */
function memberHoldingAPlace() {
  session.value = { status: 'signed-in', user: SAM };
  const place: Enrollment = {
    id: 'e7f2',
    course: {
      id: 'b2a1',
      slug: 'algebra-for-the-cbse-boards',
      title: 'Algebra for the CBSE boards',
    },
    isActive: true,
    enrolledAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
  };
  roster.myPlaces.mockResolvedValue([place]);
}

function detail(overrides: Partial<CatalogCourseDetail> = {}): CatalogCourseDetail {
  return {
    id: 'b2a1',
    slug: 'algebra-for-the-cbse-boards',
    title: 'Algebra for the CBSE boards',
    summary: 'One chapter, worked slowly.',
    description:
      'We take linear equations in one variable and do them properly.\nNo shortcuts, no skipped steps.',
    level: { code: 'intermediate', label: 'Intermediate' },
    teacher: { displayName: 'Aditi Raman' },
    price: null,
    modules: [
      {
        id: 'm1',
        title: 'Arithmetic progressions',
        summary: 'The nth term, and why it is where it is.',
        position: 1,
        lessons: [
          {
            id: 'l1',
            title: 'The nth term',
            position: 1,
            estimatedMinutes: 12,
            isFreePreview: false,
            isReadable: false,
          },
          // One of the three is open, so the counts below are a course in both states rather
          // than a screen that has only ever seen one.
          {
            id: 'l2',
            title: 'Sum of n terms',
            position: 2,
            estimatedMinutes: null,
            isFreePreview: true,
            isReadable: true,
          },
        ],
      },
      {
        id: 'm2',
        title: 'Quadratic equations',
        summary: null,
        position: 4,
        lessons: [
          {
            id: 'l3',
            title: 'Why the denominator stays put',
            position: 1,
            estimatedMinutes: 8,
            isFreePreview: false,
            isReadable: false,
          },
        ],
      },
    ],
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

/** The same course as it arrives for a student who holds a place: the API's outline answers
 * about the reader, so every published row is open while the teacher's own marks stay put. */
function withPlace(course: CatalogCourseDetail): CatalogCourseDetail {
  return {
    ...course,
    modules: course.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({ ...lesson, isReadable: true })),
    })),
  };
}

const unreadable = () =>
  new ApiError({ statusCode: 404, code: 'NOT_FOUND', message: 'We cannot find that course.' });

/** A currency as the API pairs it with an amount, so a price can be printed without the page
 * deciding what symbol belongs to a number. */
const RUPEE = { code: 'INR', label: 'Indian rupee' };

beforeEach(() => {
  session.value = { status: 'signed-out', user: null };
  // Reset rather than only re-stubbing: the call counts are what some of these tests read.
  roster.myPlaces.mockReset().mockResolvedValue([]);
  roster.heldPlaces.mockReset().mockResolvedValue([]);
  api.readCatalogCourse.mockReset().mockResolvedValue(detail());
});

describe('CourseOutline', () => {
  it('lists the syllabus the way the teacher ordered it', async () => {
    render(<CourseOutline courseId="b2a1" />);

    await screen.findByRole('heading', { name: 'Arithmetic progressions' });
    const blocks = screen.getAllByRole('heading', { level: 3 });
    expect(blocks.map((block) => block.textContent)).toEqual([
      'Arithmetic progressions',
      'Quadratic equations',
    ]);
    expect(screen.getByText('The nth term')).toBeInTheDocument();
    expect(screen.getByText('Why the denominator stays put')).toBeInTheDocument();
  });

  it('keeps the numbers the teacher gave the blocks, gaps and all', async () => {
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByRole('heading', { name: 'Quadratic equations' });

    // The API reserves a retired block's slot, so a syllabus that jumps 1 → 4 is telling the
    // truth about a block that was taken out. Renumbering here would be editing the map.
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  it('says how long each page is, and says nothing when the teacher did not guess', async () => {
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByText('The nth term');

    expect(screen.getByText(/12 min/i)).toBeInTheDocument();
    expect(screen.getByText(/not timed|no estimate/i)).toBeInTheDocument();
  });

  it('shows a locked page as locked, in words as well as in a glyph', async () => {
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByText('The nth term');

    // Two of the three nobody opened. The mark is the row's own state, said in a label a
    // screen reader hears as well as a shape a sighted visitor glances at.
    expect(screen.getAllByRole('img', { name: /behind enrollment/i })).toHaveLength(2);
  });

  it('marks the page a teacher opened as open, and links it to the page itself', async () => {
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByText('The nth term');

    expect(screen.getAllByRole('img', { name: /behind enrollment/i })).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: /free to read/i })).toHaveLength(1);

    // The door is the title, because that is the thing a visitor wanted to open; the glyph
    // only says a door exists.
    const link = screen.getByRole('link', { name: /sum of n terms/i });
    expect(link.getAttribute('href')).toBe('/courses/b2a1/lessons/l2');

    // And the other two are still names, not doors — a screen where everything looked
    // clickable would teach a visitor that none of it is.
    expect(screen.queryByRole('link', { name: /the nth term/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /why the denominator/i })).not.toBeInTheDocument();
  });

  it('opens the pages a place in the course unlocked, without calling them free', async () => {
    // Both halves of a member's read: the session that makes the answer and the roster that
    // says a place is held. `withPlace` alone would be an outline for a stranger, which is the
    // mismatch the enroll control exists to refuse to guess about.
    memberHoldingAPlace();
    api.readCatalogCourse.mockResolvedValue(withPlace(detail()));
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByText('The nth term');

    // The reader's own doors are the link rule. These two were never marked free and are a
    // door all the same; a screen that linked only the free ones would keep a student standing
    // outside a room they already hold a place in.
    expect(screen.getByRole('link', { name: /the nth term/i })).toHaveAttribute(
      'href',
      '/courses/b2a1/lessons/l1',
    );
    expect(screen.getByRole('link', { name: /why the denominator/i })).toBeInTheDocument();

    // ...and none of them is "free to read", which is the teacher's word about the page rather
    // than a description of how this reader got in. Only the one row the teacher opened wears
    // it, and nothing on the screen still claims to be behind enrollment.
    expect(screen.getAllByRole('img', { name: /free to read/i })).toHaveLength(1);
    expect(screen.queryByRole('img', { name: /behind enrollment/i })).not.toBeInTheDocument();
  });

  it('does not pitch enrollment at somebody already inside', async () => {
    memberHoldingAPlace();
    api.readCatalogCourse.mockResolvedValue(withPlace(detail()));
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByText('The nth term');

    // The explainer is a statement about what this reader may do, so it cannot stay true by
    // accident: a page already open to them is not one they are being asked to unlock. The ask
    // below it has to go quiet too — a button for a place this student already holds.
    await screen.findByText(/every page here is open to you/i);
    expect(screen.queryByText(/cannot open yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enroll/i })).not.toBeInTheDocument();
    expect(await screen.findByText(/in this course since/i)).toBeInTheDocument();
  });

  it('asks the course, not the address, what somebody is being enrolled into', async () => {
    // The page takes a slug in the url and the roster speaks in course ids, so the ask has to
    // carry the id the outline came back with. A shared link would otherwise enroll a student
    // in a course nobody named in the request.
    render(<CourseOutline courseId="algebra-for-the-cbse-boards" />);
    await screen.findByText('The nth term');

    expect(screen.getByRole('link', { name: /sign in to enroll/i })).toHaveAttribute(
      'href',
      '/login?next=%2Fcourses%2Fb2a1',
    );
  });

  it('waits for the session before it reads who may open what', async () => {
    session.value = { status: 'bootstrapping', user: null };
    const { rerender } = render(<CourseOutline courseId="b2a1" />);

    // A stranger's outline fetched now would be painted and then contradicted a moment later,
    // with a member's doors missing from under a cursor that had already moved in.
    expect(api.readCatalogCourse).not.toHaveBeenCalled();
    expect(screen.getByText(/loading this course/i)).toBeInTheDocument();

    memberHoldingAPlace();
    api.readCatalogCourse.mockResolvedValue(withPlace(detail()));
    rerender(<CourseOutline courseId="b2a1" />);

    await screen.findByRole('link', { name: /the nth term/i });
    expect(api.readCatalogCourse).toHaveBeenCalledTimes(1);
  });

  it('marks a timed page with a clock and leaves an untimed one bare', async () => {
    const { container } = render(<CourseOutline courseId="b2a1" />);
    await screen.findByText('The nth term');

    // "Not timed" is words only: a clock beside a blank would claim a number the teacher never
    // gave, and the whole value of the glyph is that it can be trusted at a glance.
    expect(container.querySelectorAll('svg[data-icon="clock"]')).toHaveLength(2);
    expect(container.querySelectorAll('svg[data-icon="lock"]')).toHaveLength(2);
    expect(container.querySelectorAll('svg[data-icon="unlock"]')).toHaveLength(1);
  });

  it('adds up the pages a student is signing up to read', async () => {
    render(<CourseOutline courseId="b2a1" />);

    await screen.findByRole('heading', { name: /Algebra for the CBSE boards/ });
    expect(screen.getByText(/2 modules/i)).toBeInTheDocument();
    expect(screen.getByText(/3 lessons/i)).toBeInTheDocument();
    expect(screen.getByText(/about 20 min/i)).toBeInTheDocument();
  });

  it('says what a quoted course costs, in the currency the teacher priced it in', async () => {
    api.readCatalogCourse.mockResolvedValue(
      detail({ price: { minorUnits: 499900, currency: RUPEE } }),
    );
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByRole('heading', { name: /Algebra for the CBSE boards/ });

    // The figure the API sent in paise, printed with the symbol of the currency beside it —
    // the page does the arithmetic in neither direction.
    expect(screen.getByText('₹4,999.00')).toBeInTheDocument();
  });

  it('says Free in words when the teacher quoted zero, not a figure that reads as a typo', async () => {
    api.readCatalogCourse.mockResolvedValue(detail({ price: { minorUnits: 0, currency: RUPEE } }));
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByRole('heading', { name: /Algebra for the CBSE boards/ });

    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.queryByText('₹0.00')).not.toBeInTheDocument();
  });

  it('says nothing about money for a course with no price, which is not the same as a free one', async () => {
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByRole('heading', { name: /Algebra for the CBSE boards/ });

    // A price line that reads "no price listed" would be the page starting a conversation about
    // money the teacher never joined — and enrollment is a place taken for free regardless.
    expect(screen.queryByText(/₹|\$|free|price|cost/i)).not.toBeInTheDocument();
  });

  it('keeps the description as it was written, line breaks included', async () => {
    const { container } = render(<CourseOutline courseId="b2a1" />);
    await screen.findByText(/do them properly/);

    // Tailwind is not compiled in a unit test, so the class name is what is checkable; the
    // point is that the line break survived the trip through the API and the screen.
    const paragraph = container.querySelector('[data-description]');
    expect(paragraph?.className).toContain('whitespace-pre-wrap');
    expect(paragraph?.textContent).toContain('\nNo shortcuts');
  });

  it('still says what an outline is: the open page is fetched, not slipped in', async () => {
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByRole('heading', { name: 'Arithmetic progressions' });

    expect(screen.getByRole('link', { name: /sign in to enroll/i })).toBeInTheDocument();
    // The list is the map. A free row adds a link and nothing else — no body, no preview
    // paragraph — so the syllabus reads the same whether or not a room happens to be open.
    expect(screen.queryByText(/cut the pie/i)).not.toBeInTheDocument();
  });

  it('goes back to the shelf from the header, not from the middle of a block', async () => {
    render(<CourseOutline courseId="b2a1" />);
    await screen.findByRole('heading', { name: /Algebra/ });

    expect(screen.getByRole('link', { name: /all courses/i }).getAttribute('href')).toBe('/');
  });

  it('says a course that is not here is not here, in the same words whatever the reason', async () => {
    api.readCatalogCourse.mockRejectedValue(unreadable());
    render(<CourseOutline courseId="b2a1" />);

    expect(await screen.findByText(/not on the shelf/i));
    // Draft, archived and never-written all answer the same way, and the screen must not
    // imply a distinction the API refuses to make.
    expect(screen.queryByText(/draft|archived/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /all courses/i })).toBeInTheDocument();
  });

  it('offers a retry when the request failed rather than the course', async () => {
    api.readCatalogCourse
      .mockRejectedValueOnce(
        new ApiError({ statusCode: 500, code: 'INTERNAL', message: 'Try again shortly.' }),
      )
      .mockResolvedValue(detail());
    render(<CourseOutline courseId="b2a1" />);

    const attemptsBeforeClick = api.readCatalogCourse.mock.calls.length;
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    await waitFor(() =>
      expect(api.readCatalogCourse.mock.calls.length).toBe(attemptsBeforeClick + 1),
    );
    await screen.findByRole('heading', { name: /Arithmetic progressions/ });
  });
});
