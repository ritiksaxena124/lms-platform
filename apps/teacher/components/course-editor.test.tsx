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

  it('locks a published course and offers to archive it instead of saving it', async () => {
    api.readCourse.mockResolvedValue(course({ status: { code: 'published', label: 'Published' } }));

    render(<CourseEditor courseId="c1" />);
    await screen.findByLabelText('Title');

    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /archive/i })).toBeEnabled();
    expect(screen.getByText(/archive it to change what a student is reading/i)).toBeInTheDocument();
  });

  it('archiving hands the course back to the teacher to edit', async () => {
    api.readCourse.mockResolvedValue(course({ status: { code: 'published', label: 'Published' } }));
    api.archiveCourse.mockResolvedValue(
      course({ status: { code: 'archived', label: 'Archived' } }),
    );

    render(<CourseEditor courseId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: /archive/i }));

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
    await userEvent.click(await screen.findByRole('button', { name: /publish/i }));

    await waitFor(() => expect(api.publishCourse).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText('Published')).toBeInTheDocument();
  });

  it('shows what publishing is missing, per field, the way the API named it', async () => {
    api.readCourse.mockResolvedValue(course({ description: null }));
    api.publishCourse.mockRejectedValue(
      validationError('description', 'Fill this in before publishing.'),
    );

    render(<CourseEditor courseId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: /publish/i }));

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
});
