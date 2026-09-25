import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLesson,
  deactivateLesson,
  listLessons,
  publishLesson,
  reorderLessons,
  unpublishLesson,
  updateLesson,
} from './lessons';

const BASE_URL = 'http://api.localtest.me:4000';

const LESSON = {
  id: 'l1',
  moduleId: 'm1',
  title: 'Equivalent fractions on a number line',
  body: 'Mark 1/2 and 2/4 on the same line.',
  estimatedMinutes: 8,
  position: 1,
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
  return {
    url: String(call[0]),
    method: String(init.method ?? 'GET'),
    body: init.body as string | undefined,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ lesson: LESSON, items: [LESSON] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('lessons client', () => {
  it('reads a module’s lessons through the module', async () => {
    await expect(listLessons('m1')).resolves.toEqual([LESSON]);
    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/modules/m1/lessons`,
      method: 'GET',
    });
  });

  it('adds a lesson without naming a slot, because the API owns the order', async () => {
    await createLesson('m1', { title: 'Halves and quarters', estimatedMinutes: 6 });

    const { url, method, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/modules/m1/lessons`);
    expect(method).toBe('POST');
    expect(JSON.parse(body ?? '{}')).toEqual({ title: 'Halves and quarters', estimatedMinutes: 6 });
  });

  it('keeps a field the teacher left out of the request rather than sending it empty', async () => {
    await createLesson('m1', { title: 'Halves and quarters' });

    expect(JSON.parse(requestAt(0).body ?? '{}')).toEqual({ title: 'Halves and quarters' });
  });

  it('sends an explicit null when the teacher clears the estimate', async () => {
    await updateLesson('m1', 'l1', { estimatedMinutes: null });

    expect(JSON.parse(requestAt(0).body ?? '{}')).toEqual({ estimatedMinutes: null });
  });

  it('edits a lesson with a patch, which is what leaves its slot alone', async () => {
    await updateLesson('m1', 'l1', { title: 'Equivalent fractions, on a number line' });

    const { url, method, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/modules/m1/lessons/l1`);
    expect(method).toBe('PATCH');
    expect(JSON.parse(body ?? '{}')).toEqual({ title: 'Equivalent fractions, on a number line' });
  });

  it('moves a lesson by patching its module, which is the edit that does change its slot', async () => {
    await updateLesson('m1', 'l1', { moduleId: 'm2' });

    const { url, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/modules/m1/lessons/l1`);
    expect(JSON.parse(body ?? '{}')).toEqual({ moduleId: 'm2' });
  });

  it('sends the whole order to reorder, and returns what the API says it is now', async () => {
    await expect(reorderLessons('m1', ['l2', 'l1'])).resolves.toEqual([LESSON]);

    const { url, method, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/modules/m1/lessons/reorder`);
    expect(method).toBe('POST');
    expect(JSON.parse(body ?? '{}')).toEqual({ lessonIds: ['l2', 'l1'] });
  });

  it('publishes with a transition and no body, because a page is checked before it is shown', async () => {
    await publishLesson('m1', 'l1');

    const { url, method, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/modules/m1/lessons/l1/publish`);
    expect(method).toBe('POST');
    expect(body).toBeUndefined();
  });

  it('takes a published lesson back to a draft', async () => {
    await unpublishLesson('m1', 'l1');

    expect(requestAt(0).url).toBe(`${BASE_URL}/api/v1/modules/m1/lessons/l1/unpublish`);
  });

  it('retires a lesson with a transition and no body', async () => {
    await deactivateLesson('m1', 'l1');

    const { url, method, body } = requestAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/modules/m1/lessons/l1/deactivate`);
    expect(method).toBe('POST');
    expect(body).toBeUndefined();
  });

  it('hands a refusal back intact, so the screen can say why publishing was refused', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'The request could not be validated.',
          details: { validation: { body: ['Write the page before publishing it.'] } },
        },
        400,
      ),
    );

    await expect(publishLesson('m1', 'l1')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { validation: { body: ['Write the page before publishing it.'] } },
    });
  });
});
