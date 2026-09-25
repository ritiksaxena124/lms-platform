import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  archiveCourse,
  courseLevels,
  createCourse,
  listCourses,
  publishCourse,
  readCourse,
  updateCourse,
} from './courses';

const BASE_URL = 'http://api.localtest.me:4000';

const COURSE = {
  id: 'c1',
  title: 'Algebra for the CBSE boards',
  slug: 'algebra-for-the-cbse-boards',
  summary: null,
  description: null,
  level: { code: 'intermediate', label: 'Intermediate' },
  status: { code: 'draft', label: 'Draft' },
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return { status, ok: status < 400, text: async () => text };
}

let fetchMock: ReturnType<typeof vi.fn>;

function requestAt(index: number): { url: string; method: string; body?: string } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  const init = (call[1] ?? {}) as RequestInit;
  return { url: String(call[0]), method: String(init.method ?? 'GET'), body: init.body as string | undefined };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ course: COURSE, items: [] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('courses client', () => {
  it('reads the whole list in one request and hands back the rows', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [COURSE] }));

    await expect(listCourses()).resolves.toEqual([COURSE]);
    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/courses`,
      method: 'GET',
    });
  });

  it('asks the API for the levels instead of keeping its own list', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ code: 'beginner', label: 'Beginner' }] }),
    );

    await expect(courseLevels()).resolves.toEqual([{ code: 'beginner', label: 'Beginner' }]);
    expect(requestAt(0).url).toBe(`${BASE_URL}/api/v1/courses/levels`);
  });

  it('reads one course by id, because an edit link is not always followed from the list', async () => {
    await expect(readCourse('c1')).resolves.toEqual(COURSE);
    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/courses/c1`,
      method: 'GET',
    });
  });

  it('posts a draft and leaves a field the teacher skipped out of the body', async () => {
    await createCourse({ title: 'Fractions, slowly', level: 'beginner' });

    const { method, body } = requestAt(0);
    expect(method).toBe('POST');
    expect(JSON.parse(body ?? '{}')).toEqual({ title: 'Fractions, slowly', level: 'beginner' });
  });

  it('sends only what an edit touched', async () => {
    await updateCourse('c1', { summary: 'A first pass at the topic.' });

    const { url, method, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/courses/c1`);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body ?? '{}')).toEqual({ summary: 'A first pass at the topic.' });
  });

  it('sends a transition as a request with no body at all', async () => {
    await publishCourse('c1');
    await archiveCourse('c1');

    const publish = requestAt(0);
    expect(publish.url).toBe(`${BASE_URL}/api/v1/courses/c1/publish`);
    expect(publish.method).toBe('POST');
    // No body: a transition decides from the row it already has. Sending `null` would make
    // the browser claim a JSON payload that says nothing.
    expect(publish.body).toBeUndefined();
    expect(requestAt(1).url).toBe(`${BASE_URL}/api/v1/courses/c1/archive`);
  });

  it('returns the course a transition produced, so the caller can repaint without refetching', async () => {
    await expect(publishCourse('c1')).resolves.toEqual(COURSE);
  });
});
