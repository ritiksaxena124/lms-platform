import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LessonAsset } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { LessonRecording } from './lesson-recording';

// Hoisted: `vi.mock` calls move above the imports, so a factory may only close over values
// that exist before this file's body runs.
const api = vi.hoisted(() => ({
  standingLessonAsset: vi.fn(),
  attachLessonAsset: vi.fn(),
  lessonAssetBytes: vi.fn(),
}));

vi.mock('@/lib/lesson-assets', () => api);

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

const FIRST_TAKE: LessonAsset = {
  id: 'a1',
  lessonId: 'l1',
  displayName: 'fractions-take-1.mp4',
  contentType: 'video/mp4',
  bytes: 5_242_880,
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
};

const SECOND_TAKE: LessonAsset = {
  ...FIRST_TAKE,
  id: 'a2',
  displayName: 'fractions-take-2.mp4',
  bytes: 1_048_576,
};

const OBJECT_URL = 'blob:http%3A//teacher.localtest.me/recording';

function refusal(
  statusCode: number,
  message: string,
  code = 'VALIDATION_FAILED',
  field?: string,
): ApiError {
  return new ApiError({
    statusCode,
    code,
    message,
    details: field ? { validation: { [field]: [message] } } : undefined,
  });
}

beforeEach(() => {
  // jsdom has no object URLs, and this block is the only thing in the portal that makes one.
  URL.createObjectURL = vi.fn(() => OBJECT_URL);
  URL.revokeObjectURL = vi.fn();
  api.standingLessonAsset.mockResolvedValue(FIRST_TAKE);
  api.attachLessonAsset.mockResolvedValue(SECOND_TAKE);
  api.lessonAssetBytes.mockResolvedValue(new Blob(['frame'], { type: 'video/mp4' }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function open(): void {
  render(<LessonRecording moduleId="m1" lessonId="l1" />);
}

async function pick(file: File): Promise<void> {
  const input = screen.getByLabelText('Recording file');
  await userEvent.upload(input, file);
}

function mp4(name = 'fractions-take-2.mp4'): File {
  return new File(['frame'], name, { type: 'video/mp4' });
}

describe('LessonRecording', () => {
  it('names the recording the page carries, and how big it is', async () => {
    open();

    expect(await screen.findByText('fractions-take-1.mp4')).toBeInTheDocument();
    expect(screen.getByText('5.0 MB')).toBeInTheDocument();
    expect(api.standingLessonAsset).toHaveBeenCalledWith('m1', 'l1');
  });

  it('says so when the page has nothing on it yet', async () => {
    api.standingLessonAsset.mockResolvedValue(null);
    open();

    expect(await screen.findByText('No recording on this page yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach a recording' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
  });

  it('sends the file the teacher picked, in the page’s own address', async () => {
    open();
    await screen.findByText('fractions-take-1.mp4');

    await pick(mp4());

    await waitFor(() =>
      expect(api.attachLessonAsset).toHaveBeenCalledWith(
        'm1',
        'l1',
        expect.objectContaining({ name: 'fractions-take-2.mp4', type: 'video/mp4' }),
      ),
    );
  });

  it('shows the recording the API filed, not the name that was typed into the box', async () => {
    open();
    await screen.findByText('fractions-take-1.mp4');

    await pick(mp4());

    await waitFor(() => expect(screen.getByText('fractions-take-2.mp4')).toBeInTheDocument());
    expect(screen.queryByText('fractions-take-1.mp4')).not.toBeInTheDocument();
    expect(notify.success).toHaveBeenCalledWith('Recording attached');
  });

  it('replaces with the one upload, and asks for nothing else', async () => {
    open();
    await screen.findByText('fractions-take-1.mp4');

    await pick(mp4());
    await waitFor(() => expect(screen.getByText('fractions-take-2.mp4')).toBeInTheDocument());

    expect(api.attachLessonAsset).toHaveBeenCalledTimes(1);
    expect(api.lessonAssetBytes).not.toHaveBeenCalled();
  });

  it('leaves a refusal on the control that caused it, and the old recording on screen', async () => {
    api.attachLessonAsset.mockRejectedValue(
      refusal(413, 'A lesson video has to be 200 MB or smaller.', 'VALIDATION_FAILED', 'file'),
    );
    open();
    await screen.findByText('fractions-take-1.mp4');

    await pick(mp4('too-big.mp4'));

    expect(
      await screen.findByText('A lesson video has to be 200 MB or smaller.'),
    ).toBeInTheDocument();
    expect(screen.getByText('fractions-take-1.mp4')).toBeInTheDocument();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('keeps a second pick out while one is going up', async () => {
    let release: () => void = () => undefined;
    api.attachLessonAsset.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(SECOND_TAKE);
        }),
    );
    open();
    await screen.findByText('fractions-take-1.mp4');

    await pick(mp4('first.mp4'));
    const input = screen.getByLabelText('Recording file');
    await waitFor(() => expect(input).toBeDisabled());

    release();
    await waitFor(() => expect(input).toBeEnabled());
  });

  it('plays through an address the portal made, because the page was never given one', async () => {
    const { container } = render(<LessonRecording moduleId="m1" lessonId="l1" />);
    await screen.findByText('fractions-take-1.mp4');

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => expect(api.lessonAssetBytes).toHaveBeenCalledWith('m1', 'l1'));
    const video = container.querySelector('video');
    await waitFor(() => expect(video?.getAttribute('src')).toBe(OBJECT_URL));
    expect(video?.getAttribute('src')).not.toContain('api/v1');
  });

  it('gives the address back when the block goes away', async () => {
    const view = render(<LessonRecording moduleId="m1" lessonId="l1" />);
    await screen.findByText('fractions-take-1.mp4');
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(URL.revokeObjectURL).not.toHaveBeenCalled());

    view.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('says so when the bytes would not come, and leaves no player behind', async () => {
    api.lessonAssetBytes.mockRejectedValue(
      refusal(404, 'We cannot find that recording.', 'NOT_FOUND'),
    );
    const { container } = render(<LessonRecording moduleId="m1" lessonId="l1" />);
    await screen.findByText('fractions-take-1.mp4');

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('We cannot find that recording.'),
    );
    expect(container.querySelector('video')).toBeNull();
  });

  it('offers a retry when the page’s recording would not describe itself', async () => {
    api.standingLessonAsset.mockRejectedValueOnce(refusal(500, 'The request did not succeed.'));
    open();

    expect(await screen.findByText('The recording did not load.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('fractions-take-1.mp4')).toBeInTheDocument();
    expect(api.standingLessonAsset).toHaveBeenCalledTimes(2);
  });
});
