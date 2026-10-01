import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Course } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { CourseEditor } from './course-editor';

// Hoisted: `vi.mock` calls move above the imports, so a factory may only close over values
// that exist before this file's body runs.
const api = vi.hoisted(() => ({
  listCourses: vi.fn(),
  readCourse: vi.fn(),
  courseLevels: vi.fn(),
  courseCurrencies: vi.fn(),
  createCourse: vi.fn(),
  updateCourse: vi.fn(),
  publishCourse: vi.fn(),
  archiveCourse: vi.fn(),
  unpublishCourse: vi.fn(),
  unarchiveCourse: vi.fn(),
}));

vi.mock('@/lib/courses', () => api);

// `vi.hoisted`, not a plain `const`: the mock factory runs while this file's imports are
// still resolving, before its body has assigned anything.
const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const LEVELS = [
  { code: 'beginner', label: 'Beginner' },
  { code: 'intermediate', label: 'Intermediate' },
];

const CURRENCIES = [
  { code: 'INR', label: 'Indian rupee' },
  { code: 'USD', label: 'US dollar' },
];

/** A quote the way the API sends one: an amount and the unit it is in, together. */
const RUPEES = { minorUnits: 499900, currency: { code: 'INR', label: 'Indian rupee' } };

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

function validationError(field: string, message: string): ApiError {
  return new ApiError({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'Check the highlighted fields.',
    details: { validation: { [field]: [message] } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.courseLevels.mockResolvedValue(LEVELS);
  api.courseCurrencies.mockResolvedValue(CURRENCIES);
});

describe('CourseEditor', () => {
  it('writes a draft and takes the teacher back to the list it now appears on', async () => {
    api.createCourse.mockResolvedValue(course());

    render(<CourseEditor />);
    await screen.findByLabelText('Title');

    await userEvent.type(screen.getByLabelText('Title'), 'Fractions, slowly');
    await userEvent.selectOptions(screen.getByLabelText('Level'), 'beginner');
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() =>
      expect(api.createCourse).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Fractions, slowly', level: 'beginner' }),
      ),
    );
    expect(push).toHaveBeenCalledWith('/courses');
  });

  it('prefills the course an edit link points at', async () => {
    api.readCourse.mockResolvedValue(course());

    render(<CourseEditor courseId="c1" />);

    expect(await screen.findByLabelText('Title')).toHaveValue('Fractions, slowly');
    expect(screen.getByLabelText('Slug')).toHaveValue('fractions-slowly');
    expect(screen.getByLabelText('Level')).toHaveValue('beginner');
  });

  it('sends the whole document an edit holds, so nothing the teacher saw is left behind', async () => {
    api.readCourse.mockResolvedValue(course());
    api.updateCourse.mockResolvedValue(course({ title: 'Fractions, properly' }));

    render(<CourseEditor courseId="c1" />);
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Fractions, properly');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateCourse).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ title: 'Fractions, properly', level: 'beginner' }),
      ),
    );
  });

  it('puts the API’s complaint about a slug under the slug, not on the page', async () => {
    api.createCourse.mockRejectedValue(
      validationError('slug', 'You already use fractions-slowly for another course.'),
    );

    render(<CourseEditor />);
    await screen.findByLabelText('Title');

    await userEvent.type(screen.getByLabelText('Title'), 'Fractions, slowly');
    await userEvent.selectOptions(screen.getByLabelText('Level'), 'beginner');
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already use fractions-slowly for another course.',
    );
    expect(screen.getByLabelText('Slug')).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps the button busy and the fields shut while the API thinks', async () => {
    let resolveCreate: ((value: Course) => void) | undefined;
    api.createCourse.mockImplementation(
      () => new Promise<Course>((resolve) => void (resolveCreate = resolve)),
    );

    render(<CourseEditor />);
    await screen.findByLabelText('Title');
    await userEvent.type(screen.getByLabelText('Title'), 'Fractions, slowly');
    await userEvent.selectOptions(screen.getByLabelText('Level'), 'beginner');
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    expect(screen.getByRole('button', { name: /save draft/i })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    resolveCreate?.(course());
  });

  it('locks a published course and offers both ways off the shelf', async () => {
    api.readCourse.mockResolvedValue(course({ status: { code: 'published', label: 'Published' } }));

    render(<CourseEditor courseId="c1" />);
    await screen.findByLabelText('Title');

    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeEnabled();
    // The gentler of the two is named first in the note, because a teacher who wants the title
    // box back is not ending the course.
    expect(
      screen.getByText(/unpublish to edit — students already enrolled keep reading it/i),
    ).toBeInTheDocument();
  });

  it('unpublishing hands the course back to the teacher to edit', async () => {
    api.readCourse.mockResolvedValue(course({ status: { code: 'published', label: 'Published' } }));
    api.unpublishCourse.mockResolvedValue(course({ status: { code: 'draft', label: 'Draft' } }));

    render(<CourseEditor courseId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Unpublish' }));

    await waitFor(() => expect(api.unpublishCourse).toHaveBeenCalledWith('c1'));
    // The row the API answered with is what gets painted: a draft, editable, with Publish on
    // offer again and no Archive — an archive is only ever a step from the shelf.
    expect(await screen.findByLabelText('Title')).toBeEnabled();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unpublish' })).not.toBeInTheDocument();
  });

  it('shows what refusing to unpublish said, and keeps the course on the shelf', async () => {
    api.readCourse.mockResolvedValue(course({ status: { code: 'published', label: 'Published' } }));
    api.unpublishCourse.mockRejectedValue(
      new ApiError({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Only a published course can be unpublished.',
        details: {},
      }),
    );

    render(<CourseEditor courseId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Unpublish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only a published course can be');
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeDisabled();
  });

  it('brings an archived course back as a draft, not onto the shelf', async () => {
    api.readCourse.mockResolvedValue(course({ status: { code: 'archived', label: 'Archived' } }));
    api.unarchiveCourse.mockResolvedValue(course({ status: { code: 'draft', label: 'Draft' } }));

    render(<CourseEditor courseId="c1" />);
    // A draft is not archived, so there is nothing to bring back; a course on the shelf is not
    // filed away either. Only the archive offers this move.
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Bring it back as a draft' }));
    await waitFor(() => expect(api.unarchiveCourse).toHaveBeenCalledWith('c1'));

    // Back among the editable courses, and the shelf is still a decision the teacher has to
    // make on its own.
    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });

  it('archiving hands the course back to the teacher to edit', async () => {
    api.readCourse.mockResolvedValue(course({ status: { code: 'published', label: 'Published' } }));
    api.archiveCourse.mockResolvedValue(
      course({ status: { code: 'archived', label: 'Archived' } }),
    );

    render(<CourseEditor courseId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(api.archiveCourse).toHaveBeenCalledWith('c1'));
    expect(await screen.findByLabelText('Title')).toBeEnabled();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('publishes a draft the API agrees is finished', async () => {
    api.readCourse.mockResolvedValue(course());
    api.publishCourse.mockResolvedValue(
      course({ status: { code: 'published', label: 'Published' } }),
    );

    render(<CourseEditor courseId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(api.publishCourse).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText('Published')).toBeInTheDocument();
  });

  it('shows what publishing is missing, per field, the way the API named it', async () => {
    api.readCourse.mockResolvedValue(course({ description: null }));
    api.publishCourse.mockRejectedValue(
      validationError('description', 'Fill this in before publishing.'),
    );

    render(<CourseEditor courseId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Fill this in before publishing.');
    expect(screen.getByLabelText('Description')).toHaveAttribute('aria-invalid', 'true');
    // Still a draft: the API refused, and the portal does not repaint what did not happen.
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('offers a retry when the level catalogue cannot be read', async () => {
    api.courseLevels.mockRejectedValueOnce(new Error('The API is unreachable.'));

    render(<CourseEditor />);

    expect(await screen.findByRole('button', { name: /try again/i })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(screen.getByLabelText('Level')).toBeInTheDocument());
  });

  it('holds the skeleton until every part of the load has arrived, not one at a time', async () => {
    // The catalogue and the course are one request whose answer is derived as a whole: an empty
    // level select beside a filled-in title would be a half-loaded form, and loading is read off
    // the key the reply carries rather than flipped by a flag mid-effect.
    let releaseLevels: ((value: unknown) => void) | undefined;
    api.courseLevels.mockReturnValue(new Promise((resolve) => void (releaseLevels = resolve)));
    api.readCourse.mockResolvedValue(course());

    render(<CourseEditor courseId="c1" />);

    // The course has come back but the catalogue has not — nothing is painted yet.
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();

    releaseLevels?.(LEVELS);
    expect(await screen.findByLabelText('Title')).toHaveValue('Fractions, slowly');
  });

  describe('the price', () => {
    it('offers the currencies the catalogue lists, not three strings of its own', async () => {
      api.readCourse.mockResolvedValue(course());

      render(<CourseEditor courseId="c1" />);
      const currency = await screen.findByLabelText('Currency');

      expect(within(currency).getByRole('option', { name: 'Indian rupee' })).toBeInTheDocument();
      expect(within(currency).getByRole('option', { name: 'US dollar' })).toBeInTheDocument();
    });

    it('shows a price the course carries as an amount and a unit, apart again', async () => {
      api.readCourse.mockResolvedValue(course({ price: RUPEES }));

      render(<CourseEditor courseId="c1" />);

      // The API sends 499900 because that is what the column holds; a teacher reads money the
      // way they type it, and the form is where the two are translated.
      expect(await screen.findByLabelText('Price')).toHaveValue('4999.00');
      expect(screen.getByLabelText('Currency')).toHaveValue('INR');
    });

    it('leaves both boxes empty when the course has no price, which is not the same as zero', async () => {
      api.readCourse.mockResolvedValue(course({ price: null }));

      render(<CourseEditor courseId="c1" />);

      expect(await screen.findByLabelText('Price')).toHaveValue('');
      expect(screen.getByLabelText('Currency')).toHaveValue('');
    });

    it('quotes a price as one decision: the amount typed and the currency chosen', async () => {
      api.readCourse.mockResolvedValue(course());
      api.updateCourse.mockResolvedValue(course({ price: RUPEES }));

      render(<CourseEditor courseId="c1" />);
      await userEvent.type(await screen.findByLabelText('Price'), '1999');
      await userEvent.selectOptions(screen.getByLabelText('Currency'), 'INR');
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() =>
        expect(api.updateCourse).toHaveBeenCalledWith(
          'c1',
          expect.objectContaining({ price: { minorUnits: 199900, currency: 'INR' } }),
        ),
      );
    });

    it('clears a price when the teacher empties both boxes', async () => {
      api.readCourse.mockResolvedValue(course({ price: RUPEES }));
      api.updateCourse.mockResolvedValue(course({ price: null }));

      render(<CourseEditor courseId="c1" />);
      await userEvent.clear(await screen.findByLabelText('Price'));
      await userEvent.selectOptions(screen.getByLabelText('Currency'), 'No price');
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

      // `null`, not an absent key: the teacher watched both boxes go empty, and a patch that
      // said nothing would leave ₹4,999 standing on the shelf behind them.
      await waitFor(() =>
        expect(api.updateCourse).toHaveBeenCalledWith(
          'c1',
          expect.objectContaining({ price: null }),
        ),
      );
    });

    it('keeps a half-filled price on the page and names the box that is missing', async () => {
      api.readCourse.mockResolvedValue(course());

      render(<CourseEditor courseId="c1" />);
      await userEvent.type(await screen.findByLabelText('Price'), '1999');
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

      // A round trip would come back saying the same thing, and a request that cannot be a
      // price is not one worth sending.
      expect(api.updateCourse).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toHaveTextContent(/currency/i);
      expect(screen.getByLabelText('Currency')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByLabelText('Price')).toHaveValue('1999');
    });

    it('says so when the amount cannot be read as money', async () => {
      api.readCourse.mockResolvedValue(course());

      render(<CourseEditor courseId="c1" />);
      await userEvent.type(await screen.findByLabelText('Price'), '1,999');
      await userEvent.selectOptions(screen.getByLabelText('Currency'), 'INR');
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

      expect(api.updateCourse).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByLabelText('Price')).toHaveAttribute('aria-invalid', 'true');
    });

    it('puts the API’s complaint about a currency under the currency', async () => {
      api.readCourse.mockResolvedValue(course());
      api.updateCourse.mockRejectedValue(
        validationError('price', 'Not a currency we know: bitcoin'),
      );

      render(<CourseEditor courseId="c1" />);
      await userEvent.type(await screen.findByLabelText('Price'), '1999');
      await userEvent.selectOptions(screen.getByLabelText('Currency'), 'INR');
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

      // The API names the pair rather than the box, and the only thing wrong with a pair can
      // be its unit — so the message lands where the teacher chose it.
      expect(await screen.findByRole('alert')).toHaveTextContent('Not a currency we know');
      expect(screen.getByLabelText('Currency')).toHaveAttribute('aria-invalid', 'true');
    });

    it('refuses a price the teacher cannot type on a published course, like everything else', async () => {
      api.readCourse.mockResolvedValue(
        course({ status: { code: 'published', label: 'Published' }, price: RUPEES }),
      );

      render(<CourseEditor courseId="c1" />);

      expect(await screen.findByLabelText('Price')).toBeDisabled();
      expect(screen.getByLabelText('Currency')).toBeDisabled();
    });
  });

  describe('the sentences beside the lifecycle moves', () => {
    /** The bubble a mark describes. The sentence is in the document from the first render — that is
     * what lets a keyboard reach it — so `data-open` is the only thing the pointer changes. */
    function tipFor(mark: HTMLElement): HTMLElement | null {
      return document.getElementById(mark.getAttribute('aria-describedby') ?? '');
    }

    it('says that archiving closes the pages on the students who hold a place', async () => {
      const user = userEvent.setup({ delay: null });
      api.readCourse.mockResolvedValue(course({ status: { code: 'published', label: 'Published' } }));

      render(<CourseEditor courseId="c1" />);
      const archive = await screen.findByRole('button', { name: 'What Archive does' });
      await screen.findByRole('button', { name: 'What Unpublish does' });

      expect(tipFor(archive)).not.toHaveAttribute('data-open');

      await user.hover(archive);
      expect(tipFor(archive)).toHaveAttribute('data-open', 'true');
      expect(tipFor(archive)).toHaveTextContent(
        'Ends the course for everybody, including the students who hold a place in it.',
      );
    });

    it('says that pausing is not the same move, while both are offered together', async () => {
      const user = userEvent.setup({ delay: null });
      api.readCourse.mockResolvedValue(course({ status: { code: 'published', label: 'Published' } }));

      render(<CourseEditor courseId="c1" />);
      const unpublish = await screen.findByRole('button', { name: 'What Unpublish does' });

      await user.hover(unpublish);
      expect(tipFor(unpublish)).toHaveTextContent(
        'Off the shelf for strangers, editable again for you, and still open to every student who holds a place.',
      );
    });

    it('says what a draft is about to become before the teacher asks', async () => {
      const user = userEvent.setup({ delay: null });
      api.readCourse.mockResolvedValue(course());

      render(<CourseEditor courseId="c1" />);
      const publish = await screen.findByRole('button', { name: 'What Publish does' });

      await user.hover(publish);
      expect(tipFor(publish)).toHaveTextContent(
        'Puts the course on the shelf, lets a student take a place, and locks the form.',
      );
    });

    it('says that an archive comes back as a draft and not onto the shelf', async () => {
      const user = userEvent.setup({ delay: null });
      api.readCourse.mockResolvedValue(course({ status: { code: 'archived', label: 'Archived' } }));

      render(<CourseEditor courseId="c1" />);
      const unarchive = await screen.findByRole('button', { name: 'What bringing it back does' });

      await user.hover(unarchive);
      expect(tipFor(unarchive)).toHaveTextContent(
        'Returns the course to you as a draft, at the address it never lost. Putting it back on the shelf is a separate decision.',
      );
    });

    it('describes the move instead of making it, so a curious hover cannot cost a course its shelf', async () => {
      const user = userEvent.setup({ delay: null });
      api.readCourse.mockResolvedValue(course({ status: { code: 'published', label: 'Published' } }));

      render(<CourseEditor courseId="c1" />);
      const archive = await screen.findByRole('button', { name: 'What Archive does' });

      await user.click(archive);
      expect(api.archiveCourse).not.toHaveBeenCalled();
    });
  });
});
