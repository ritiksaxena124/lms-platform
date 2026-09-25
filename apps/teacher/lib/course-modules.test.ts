import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createModule,
  deactivateModule,
  listModules,
  reorderModules,
  updateModule,
} from './course-modules';

const BASE_URL = 'http://api.localtest.me:4000';

const MODULE = {
  id: 'm1',
  courseId: 'c1',
  title: 'Equivalent fractions',
  summary: null,
  description: null,
  position: 1,
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
  return {
    url: String(call[0]),
    method: String(init.method ?? 'GET'),
    body: init.body as string | undefined,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ module: MODULE, items: [MODULE] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('course modules client', () => {
  it('reads a course’s syllabus through the course, never by module id alone', async () => {
    await expect(listModules('c1')).resolves.toEqual([MODULE]);
    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/courses/c1/modules`,
      method: 'GET',
    });
  });

  it('adds a module without naming a slot, because the API owns the order', async () => {
    await createModule('c1', { title: 'Equivalent fractions' });

    const { url, method, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/courses/c1/modules`);
    expect(method).toBe('POST');
    expect(JSON.parse(body ?? '{}')).toEqual({ title: 'Equivalent fractions' });
  });

  it('keeps a paragraph the teacher left out of the body rather than sending it empty', async () => {
    await createModule('c1', { title: 'Adding fractions', summary: 'Same denominator first.' });

    expect(JSON.parse(requestAt(0).body ?? '{}')).toEqual({
      title: 'Adding fractions',
      summary: 'Same denominator first.',
    });
  });

  it('renames a module with a patch, which is what leaves its slot alone', async () => {
    await updateModule('c1', 'm1', { title: 'Equivalent fractions, on a number line' });

    const { url, method, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/courses/c1/modules/m1`);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body ?? '{}')).toEqual({ title: 'Equivalent fractions, on a number line' });
  });

  it('sends the whole order to reorder, and returns what the API says it is now', async () => {
    await expect(reorderModules('c1', ['m2', 'm1'])).resolves.toEqual([MODULE]);

    const { url, method, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/courses/c1/modules/reorder`);
    expect(method).toBe('POST');
    expect(JSON.parse(body ?? '{}')).toEqual({ moduleIds: ['m2', 'm1'] });
  });

  it('takes a module out with a transition and no body', async () => {
    await deactivateModule('c1', 'm1');

    const { url, method, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/courses/c1/modules/m1/deactivate`);
    expect(method).toBe('POST');
    expect(body).toBeUndefined();
  });

  it('hands a refusal back intact, so the screen can say why removal was rejected', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Archive the course to take a module out of what a student is reading.',
        },
        409,
      ),
    );

    await expect(deactivateModule('c1', 'm1')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Archive the course to take a module out of what a student is reading.',
    });
  });
});
