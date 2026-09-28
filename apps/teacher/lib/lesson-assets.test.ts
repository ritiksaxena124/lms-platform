import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonAsset } from '@lms/shared';

import { setAccessToken } from './api';
import { attachLessonAsset, lessonAssetBytes, standingLessonAsset } from './lesson-assets';

const BASE_URL = 'http://api.localtest.me:4000';

const ASSET: LessonAsset = {
  id: 'a1',
  lessonId: 'l1',
  displayName: 'equivalent-fractions take 2.mp4',
  contentType: 'video/mp4',
  bytes: 5_242_880,
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return { status, ok: status < 400, text: async () => text };
}

function byteResponse(bytes: number[], status = 200) {
  return {
    status,
    ok: status < 400,
    blob: async () => new Blob([new Uint8Array(bytes)]),
    text: async () => '',
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function callAt(index: number): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

function headerNamesOf(index: number): string[] {
  const { init } = callAt(index);
  return Object.keys((init.headers ?? {}) as Record<string, string>).map((name) =>
    name.toLowerCase(),
  );
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  // Both calls below travel with the session: neither route answers a stranger, and the
  // transport is what puts the token on them.
  setAccessToken('teacher-token');
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ asset: ASSET }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('lesson asset client', () => {
  it('asks the page what stands on it, and takes the null as an answer', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ asset: null }));

    await expect(standingLessonAsset('m1', 'l1')).resolves.toBeNull();
    expect(callAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/modules/m1/lessons/l1/asset`,
      init: { method: 'GET' },
    });
  });

  it('sends the file in the field the API reads it out of', async () => {
    const file = new File(['0100110'], 'lesson.mp4', { type: 'video/mp4' });

    await expect(attachLessonAsset('m1', 'l1', file)).resolves.toEqual(ASSET);

    const { url, init } = callAt(0);
    expect(url).toBe(`${BASE_URL}/api/v1/modules/m1/lessons/l1/asset`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBe(file);
  });

  it('leaves the content-type alone, because only the browser knows the multipart boundary', async () => {
    await attachLessonAsset('m1', 'l1', new File(['0100110'], 'lesson.mp4'));

    expect(headerNamesOf(0)).toContain('authorization');
    expect(headerNamesOf(0)).not.toContain('content-type');
  });

  it('reads the bytes for a player, since the page has no URL for them', async () => {
    fetchMock.mockResolvedValueOnce(byteResponse([1, 2, 3]));

    const bytes = await lessonAssetBytes('m1', 'l1');

    expect(callAt(0).url).toBe(`${BASE_URL}/api/v1/modules/m1/lessons/l1/asset/video`);
    expect(bytes.size).toBe(3);
    expect(headerNamesOf(0)).toContain('authorization');
  });

  it('hands a refusal back keyed to the file, so the block can put it under its own control', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 413,
          code: 'VALIDATION_FAILED',
          message: 'Check the highlighted fields.',
          details: { validation: { file: ['A lesson video has to be 200 MB or smaller.'] } },
        },
        413,
      ),
    );

    await expect(
      attachLessonAsset('m1', 'l1', new File(['0100110'], 'lesson.mp4')),
    ).rejects.toMatchObject({
      statusCode: 413,
      code: 'VALIDATION_FAILED',
      details: { validation: { file: ['A lesson video has to be 200 MB or smaller.'] } },
    });
  });
});
