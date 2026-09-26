import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_ERROR_CODES } from '@lms/shared';

import { browseCatalog, catalogLevels, readCatalogCourse, readFreeLesson } from './catalog';

const BASE_URL = 'http://api.localtest.me:4000';

const COURSE = {
  id: 'b2a1',
  slug: 'algebra-for-the-cbse-boards',
  title: 'Algebra for the CBSE boards',
  summary: 'One chapter, worked slowly.',
  level: { code: 'intermediate', label: 'Intermediate' },
  teacher: { displayName: 'Aditi Raman' },
  moduleCount: 2,
  lessonCount: 5,
  updatedAt: '2026-09-25T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return { status, ok: status < 400, text: async () => text };
}

function urlAt(index: number): string {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  return String(call[0]);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('browseCatalog', () => {
  it('asks for the whole shelf when nothing is filtered', async () => {
    await browseCatalog({});

    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/catalog/courses`);
  });

  it('leaves out the filters nobody chose, including a search that is only spaces', async () => {
    await browseCatalog({ level: undefined, q: '   ', page: 1 });

    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/catalog/courses`);
  });

  it('sends the level code, not its label', async () => {
    await browseCatalog({ level: 'beginner' });

    expect(urlAt(0)).toContain('?level=beginner');
  });

  it('encodes what a visitor typed rather than trusting it as syntax', async () => {
    await browseCatalog({ q: 'fractions & decimals?' });

    expect(urlAt(0)).toContain(`q=fractions%20%26%20decimals%3F`);
  });

  it('names a page only once there is a page to name', async () => {
    await browseCatalog({ q: 'algebra', page: 3 });

    expect(urlAt(0)).toContain('q=algebra');
    expect(urlAt(0)).toContain('page=3');
  });

  it('keeps the counts that tell the screen whether more is coming', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [COURSE], page: 2, pageSize: 12, total: 30 }),
    );

    await expect(browseCatalog({ page: 2 })).resolves.toEqual({
      items: [COURSE],
      page: 2,
      pageSize: 12,
      total: 30,
    });
  });
});

describe('catalogLevels', () => {
  it('reads the levels a search can be narrowed to', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ code: 'beginner', label: 'Beginner' }] }),
    );

    await expect(catalogLevels()).resolves.toEqual([{ code: 'beginner', label: 'Beginner' }]);
    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/catalog/courses/levels`);
  });
});

describe('readCatalogCourse', () => {
  it('hands back the course inside the envelope, so the caller never unwraps twice', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ course: { ...COURSE, modules: [] } }));

    await expect(readCatalogCourse('b2a1')).resolves.toMatchObject({ id: 'b2a1' });
    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/catalog/courses/b2a1`);
  });

  it('lets a refusal travel up with its code, because the screen answers 404 differently', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 404, code: API_ERROR_CODES.NOT_FOUND, message: 'We cannot find that course.' },
        404,
      ),
    );

    await expect(readCatalogCourse('b2a1')).rejects.toMatchObject({
      code: API_ERROR_CODES.NOT_FOUND,
    });
  });
});

describe('readFreeLesson', () => {
  it('asks for the pair the page belongs to, and unwraps the lesson', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ lesson: { id: 'l9', title: 'Adding halves', body: 'Cut the pie twice.' } }),
    );

    await expect(readFreeLesson('b2a1', 'l9')).resolves.toMatchObject({ id: 'l9' });
    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/catalog/courses/b2a1/lessons/l9`);
  });

  it('encodes both halves of the address rather than trusting either', async () => {
    await readFreeLesson('c 1', 'l/2');

    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/catalog/courses/c%201/lessons/l%2F2`);
  });

  it('says nothing different about a locked page and a missing one', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 404, code: API_ERROR_CODES.NOT_FOUND, message: 'We cannot find that page.' },
        404,
      ),
    );

    // The API cannot tell these two apart and neither may the portal: a screen that said
    // "this page is locked" would be a list of pages to enroll for.
    await expect(readFreeLesson('b2a1', 'l9')).rejects.toMatchObject({
      code: API_ERROR_CODES.NOT_FOUND,
    });
  });
});
