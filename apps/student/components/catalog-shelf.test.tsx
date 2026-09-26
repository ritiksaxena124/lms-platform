import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogCourse } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { CatalogShelf } from './catalog-shelf';

// Hoisted: `vi.mock` calls move above the imports, so a factory may only close over values
// that exist before this file's body runs.
const api = vi.hoisted(() => ({
  browseCatalog: vi.fn(),
  catalogLevels: vi.fn(),
}));

vi.mock('@/lib/catalog', () => api);

function course(overrides: Partial<CatalogCourse> = {}): CatalogCourse {
  return {
    id: 'b2a1',
    slug: 'algebra-for-the-cbse-boards',
    title: 'Algebra for the CBSE boards',
    summary: 'One chapter, worked slowly, with the mistakes left in.',
    level: { code: 'intermediate', label: 'Intermediate' },
    teacher: { displayName: 'Aditi Raman' },
    moduleCount: 2,
    lessonCount: 5,
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

const ALGEBRA = course();
const VERBS = course({
  id: 'v3',
  slug: 'verbs-in-passing',
  title: 'Verbs in passing',
  summary: null,
  level: { code: 'beginner', label: 'Beginner' },
  teacher: { displayName: 'Kunal Bhatia' },
  moduleCount: 1,
  lessonCount: 3,
});

function page(items: CatalogCourse[], pageNo = 1, total = items.length) {
  return { items, page: pageNo, pageSize: 12, total };
}

const notFound = () =>
  new ApiError({ statusCode: 404, code: 'NOT_FOUND', message: 'We cannot find that course.' });

beforeEach(() => {
  api.browseCatalog.mockResolvedValue(page([ALGEBRA, VERBS]));
  api.catalogLevels.mockResolvedValue([
    { code: 'beginner', label: 'Beginner' },
    { code: 'intermediate', label: 'Intermediate' },
    { code: 'advanced', label: 'Advanced' },
  ]);
});

describe('CatalogShelf', () => {
  it('puts what the API sent on the shelf', async () => {
    render(<CatalogShelf />);

    expect(await screen.findByRole('heading', { name: 'Algebra for the CBSE boards' }));
    expect(screen.getByRole('heading', { name: 'Verbs in passing' }));
    expect(screen.getByText('Aditi Raman'));
    // The counts a card shows are the counts the detail will list, so they are worth naming.
    expect(within(screen.getByRole('link', { name: /Algebra/ }).closest('li')!).getByText(/5 lessons/));
  });

  it('shows where a course came from, not that it was written', async () => {
    render(<CatalogShelf />);
    const card = (await screen.findByRole('link', { name: /Verbs/ })).closest('li')!;

    expect(within(card).getByText('Beginner'));
    // A course with no summary is a course whose teacher never wrote one; the card says
    // nothing rather than "null" or an empty gap.
    expect(within(card).queryByText(/undefined|null/i)).not.toBeInTheDocument();
  });

  it('offers only the levels the API is holding courses at', async () => {
    render(<CatalogShelf />);

    const chips = await screen.findByRole('group', { name: /level/i });
    expect(within(chips).getByRole('button', { name: 'Beginner' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Advanced' })).toBeInTheDocument();
    expect(within(chips).queryByRole('button', { name: 'Published' })).not.toBeInTheDocument();
  });

  it('asks for a narrower shelf when a level is chosen', async () => {
    render(<CatalogShelf />);
    const chips = await screen.findByRole('group', { name: /level/i });

    await userEvent.click(within(chips).getByRole('button', { name: 'Beginner' }));

    await waitFor(() => expect(api.browseCatalog).toHaveBeenLastCalledWith({ level: 'beginner' }));
  });

  it('gives a chosen level back when it is pressed again', async () => {
    render(<CatalogShelf />);
    const chips = await screen.findByRole('group', { name: /level/i });

    await userEvent.click(within(chips).getByRole('button', { name: 'Beginner' }));
    await userEvent.click(within(chips).getByRole('button', { name: 'Beginner' }));

    await waitFor(() => expect(api.browseCatalog).toHaveBeenLastCalledWith({}));
  });

  it('waits for the typing to stop before searching', async () => {
    render(<CatalogShelf />);
    await screen.findByRole('heading', { name: /Algebra/ });
    api.browseCatalog.mockClear();

    await userEvent.type(screen.getByLabelText(/search courses/i), 'frac');

    // One keystroke in: nothing has been asked. A search on every key would put a round
    // trip between a visitor and the letter they just typed.
    expect(api.browseCatalog).not.toHaveBeenCalled();

    await waitFor(() => expect(api.browseCatalog).toHaveBeenCalledWith({ q: 'frac' }), {
      timeout: 2000,
    });
  });

  it('keeps the level while the search changes, and starts back at the first page', async () => {
    render(<CatalogShelf />);
    const chips = await screen.findByRole('group', { name: /level/i });
    await userEvent.click(within(chips).getByRole('button', { name: 'Beginner' }));
    await waitFor(() => expect(api.browseCatalog).toHaveBeenLastCalledWith({ level: 'beginner' }));

    await userEvent.type(screen.getByLabelText(/search courses/i), 'verbs');

    await waitFor(
      () => expect(api.browseCatalog).toHaveBeenLastCalledWith({ level: 'beginner', q: 'verbs' }),
      { timeout: 2000 },
    );
  });

  it('goes back a page and forward again without losing the filters', async () => {
    api.browseCatalog.mockImplementation(async (input: { page?: number } = {}) =>
      page([ALGEBRA], input.page ?? 1, 20),
    );
    render(<CatalogShelf />);
    await screen.findByRole('heading', { name: /Algebra/ });

    await userEvent.click(screen.getByRole('button', { name: /next page|older/i }));
    await waitFor(() => expect(api.browseCatalog).toHaveBeenLastCalledWith({ page: 2 }));
    expect(screen.getByText(/page 2 of 2/i));

    await userEvent.click(screen.getByRole('button', { name: /previous|newer/i }));
    await waitFor(() => expect(api.browseCatalog).toHaveBeenLastCalledWith({}));
  });

  it('does not build a pager for a shelf that fits on one page', async () => {
    api.browseCatalog.mockResolvedValue(page([ALGEBRA], 1, 12));
    render(<CatalogShelf />);
    await screen.findByRole('heading', { name: /Algebra/ });

    // A disabled control that has never had anywhere to go is noise; the second page is what
    // earns the row of buttons.
    expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/page 1 of/i)).not.toBeInTheDocument();
  });

  it('says an empty search is an invitation, not a dead end', async () => {
    api.browseCatalog.mockResolvedValue(page([], 1, 0));
    render(<CatalogShelf />);
    await userEvent.type(screen.getByLabelText(/search courses/i), 'quantum');

    expect(await screen.findByText(/nothing on the shelf matches that/i));
    expect(screen.getByText(/try fewer words/i));
    await userEvent.click(screen.getByRole('button', { name: /clear the search/i }));
    await waitFor(() => expect(api.browseCatalog).toHaveBeenLastCalledWith({}));
  });

  it('says a shelf with nothing on it at all, without blaming the visitor', async () => {
    api.browseCatalog.mockResolvedValue(page([], 1, 0));
    render(<CatalogShelf />);

    expect(await screen.findByText(/nothing on the shelf yet/i));
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
  });

  it('offers a retry that asks the API again', async () => {
    api.browseCatalog.mockRejectedValueOnce(notFound());
    render(<CatalogShelf />);

    await screen.findByRole('button', { name: /try again/i });
    api.browseCatalog.mockClear();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(api.browseCatalog).toHaveBeenCalledTimes(1));
    await screen.findByRole('heading', { name: /Algebra/ });
  });

  it('settles back onto the first page when the filters change mid-list', async () => {
    api.browseCatalog.mockImplementation(async (input: { page?: number } = {}) =>
      page([ALGEBRA], input.page ?? 1, 20),
    );
    render(<CatalogShelf />);
    await screen.findByRole('heading', { name: /Algebra/ });
    await userEvent.click(screen.getByRole('button', { name: /next page|older/i }));
    await waitFor(() => expect(api.browseCatalog).toHaveBeenLastCalledWith({ page: 2 }));

    const chips = await screen.findByRole('group', { name: /level/i });
    await userEvent.click(within(chips).getByRole('button', { name: 'Advanced' }));

    await waitFor(() => expect(api.browseCatalog).toHaveBeenLastCalledWith({ level: 'advanced' }));
    expect(screen.queryByText(/page 2 of/i)).not.toBeInTheDocument();
  });
});
