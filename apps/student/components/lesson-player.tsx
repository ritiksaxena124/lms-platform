'use client';

import { useEffect, useState } from 'react';
import { Button, notify } from '@lms/ui';
import type { CatalogLessonVideo } from '@lms/shared';

import { describeFailure } from '@/lib/api';
import { lessonVideoBytes } from '@/lib/catalog';

/**
 * The recording one page carries, for the person reading that page.
 *
 * The page's own response named this file and said how long it is, which is why the block can
 * exist at all: a student's screen has no way to ask a lesson what it holds, and a portal that
 * found out by trying to download it would be fetching a two-hour lesson to decide whether to
 * draw a box around it.
 *
 * So the metadata comes with the text and the bytes come only when pressed. The file arrives as a
 * Blob the portal hands an object URL to, because there is no URL for a recording on this
 * platform — the route that streams it is the same one that decided this reader may read the page
 * it belongs to (ARCHITECTURE §6). Keeping the whole file in memory is what lets a student scrub
 * anywhere in a lesson without another request, and is also what makes the address below a lease
 * that has to be handed back.
 */

/** In MB with one decimal: a student is deciding whether to press play on a phone connection,
 * not auditing a byte count. */
function sizeLabel(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LessonPlayer({
  courseId,
  lessonId,
  video,
}: {
  courseId: string;
  lessonId: string;
  video: CatalogLessonVideo | null;
}) {
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // An object URL is a lease on the file in memory, not a value: left unreleased, a lesson the
  // student already watched keeps its bytes alive for the rest of the tab's life.
  useEffect(() => {
    if (!playerUrl) return;
    return () => {
      URL.revokeObjectURL(playerUrl);
    };
  }, [playerUrl]);

  if (!video) return null;

  async function play(): Promise<void> {
    if (playerUrl) {
      setPlayerUrl(null);
      return;
    }

    setLoading(true);
    try {
      const bytes = await lessonVideoBytes(courseId, lessonId);
      setPlayerUrl(URL.createObjectURL(bytes));
    } catch (error) {
      // A door that closed while the page sat open — an enrollment that ended, a course pulled
      // back — answers here rather than on the page read, and a player that simply did not
      // appear would say nothing about why.
      notify.error(describeFailure(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 border-y border-line py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[0.8125rem]">
          <span className="text-label text-ink-muted">Recording</span>
          <span className="text-ink">{video.displayName}</span>
          <span className="text-ink-faint">{sizeLabel(video.bytes)}</span>
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={loading}
          onClick={() => void play()}
        >
          {playerUrl ? 'Hide' : 'Play'}
        </Button>
      </div>

      {playerUrl ? (
        <video
          controls
          src={playerUrl}
          aria-label={`Recording: ${video.displayName}`}
          className="mt-3 w-full max-w-3xl rounded-card border border-line bg-paper-sunk"
        />
      ) : null}
    </section>
  );
}
