import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogLessonVideo } from '@lms/shared';

import { LessonPlayer } from './lesson-player';

// Hoisted: `vi.mock` calls move above the imports, so a factory may only close over values that
// exist before this file's body runs.
const api = vi.hoisted(() => ({ lessonVideoBytes: vi.fn() }));

vi.mock('@/lib/catalog', () => api);

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

const RECORDING: CatalogLessonVideo = { displayName: 'adding-halves.mp4', bytes: 5_242_880 };

const OBJECT_URL = 'blob:http%3A//student.localtest.me/recording';

beforeEach(() => {
  // jsdom has no object URLs, and this is the only block in the portal that makes one.
  URL.createObjectURL = vi.fn(() => OBJECT_URL);
  URL.revokeObjectURL = vi.fn();
  api.lessonVideoBytes.mockResolvedValue(new Blob(['frame'], { type: 'video/mp4' }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function open(video: CatalogLessonVideo | null = RECORDING) {
  return render(<LessonPlayer courseId="c1" lessonId="l1" video={video} />);
}

describe('LessonPlayer', () => {
  it('names the file the page carries without fetching it', async () => {
    open();

    expect(await screen.findByText('adding-halves.mp4')).toBeInTheDocument();
    expect(screen.getByText('5.0 MB')).toBeInTheDocument();
    // The page already said there was a recording, so the file has no reason to move across the
    // network just to draw a box. A student on a phone pays for that in data.
    expect(api.lessonVideoBytes).not.toHaveBeenCalled();
  });

  it('draws nothing for a page with no recording on it', () => {
    const { container } = open(null);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
  });

  it('waits for a press before it asks for a single byte', () => {
    open();

    expect(document.querySelector('video')).toBeNull();
  });

  it('plays through an address the portal made, because the API never sent one', async () => {
    open();
    await screen.findByText('adding-halves.mp4');

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => expect(api.lessonVideoBytes).toHaveBeenCalledWith('c1', 'l1'));
    const video = document.querySelector('video');
    await waitFor(() => expect(video?.getAttribute('src')).toBe(OBJECT_URL));
    expect(video?.getAttribute('src')).not.toContain('api/v1');
  });

  it('holds the file back until it has arrived, so a second press cannot start a second read', async () => {
    let release: (bytes: Blob) => void = () => undefined;
    api.lessonVideoBytes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    open();
    await screen.findByText('adding-halves.mp4');

    const play = screen.getByRole('button', { name: 'Play' });
    await userEvent.click(play);
    await waitFor(() => expect(play).toBeDisabled());

    release(new Blob(['frame'], { type: 'video/mp4' }));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    expect(api.lessonVideoBytes).toHaveBeenCalledTimes(1);
  });

  it('gives the address back when the student hides the player', async () => {
    open();
    await screen.findByText('adding-halves.mp4');
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
    expect(document.querySelector('video')).toBeNull();
  });

  it('gives the address back when the page goes away', async () => {
    const view = open();
    await screen.findByText('adding-halves.mp4');
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(URL.revokeObjectURL).not.toHaveBeenCalled());

    view.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('says so when the bytes would not come, and leaves no player behind', async () => {
    api.lessonVideoBytes.mockRejectedValue(new Error('We cannot find that recording.'));
    open();
    await screen.findByText('adding-halves.mp4');

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));

    // The door can close while the page is still on screen — an enrollment that ends, a course
    // that gets withdrawn — and the one answer that is not allowed here is a silent box.
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('We cannot find that recording.'),
    );
    expect(document.querySelector('video')).toBeNull();
  });
});
