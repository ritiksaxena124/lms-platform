import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClassRoll, SaveRollInput } from '@lms/shared';

import { myClassRoll, saveClassRoll } from './class-roll';

const BASE_URL = 'http://api.localtest.me:4000';

function roll(overrides: Partial<ClassRoll> = {}): ClassRoll {
  return {
    classId: 'o1',
    course: { id: 'c1', slug: 'veena-basics', title: 'Veena Basics' },
    startsAt: '2026-09-28T04:00:00.000Z',
    endsAt: '2026-09-28T04:45:00.000Z',
    canMark: true,
    lines: [
      { id: 'a1', student: { id: 's1', fullName: 'Sima Kundu' }, status: 'present' },
      { id: 'a2', student: { id: 's2', fullName: 'Arun Basu' }, status: null },
    ],
    ...overrides,
  };
}

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
  fetchMock = vi.fn().mockResolvedValue(jsonResponse(roll()));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('class roll client', () => {
  it('reads one class’s roll at that class’s own address', async () => {
    await expect(myClassRoll('o1')).resolves.toEqual(roll());

    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/classes/o1/roll`,
      method: 'GET',
    });
  });

  it('writes the roll with the whole sheet, because marking is one act over the names', async () => {
    const input: SaveRollInput = {
      lines: [
        { studentId: 's1', status: 'present' },
        { studentId: 's2', status: 'absent' },
      ],
    };

    await saveClassRoll('o1', input);

    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/classes/o1/roll`,
      method: 'PUT',
    });
    expect(JSON.parse(requestAt(0).body ?? '{}')).toEqual(input);
  });

  it('sends a cleared mark as a null, which is a correction rather than a word nobody gave', async () => {
    const input: SaveRollInput = { lines: [{ studentId: 's1', status: null }] };

    await saveClassRoll('o1', input);

    expect(JSON.parse(requestAt(0).body ?? '{}')).toEqual(input);
  });

  it('quotes the class id out of the address, so an odd id cannot reach a different route', async () => {
    await myClassRoll('o/1');

    expect(requestAt(0).url).toBe(`${BASE_URL}/api/v1/classes/o%2F1/roll`);
  });

  it('hands back the refusal, so the screen can say why the roll stayed shut', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'A class that has not started has no attendance to write yet.',
        },
        409,
      ),
    );

    await expect(saveClassRoll('o1', { lines: [] })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'A class that has not started has no attendance to write yet.',
    });
  });
});
