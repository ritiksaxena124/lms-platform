'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button, Spinner, notify } from '@lms/ui';
import type { LessonAsset } from '@lms/shared';

import { describeFailure, fieldErrors } from '@/lib/api';
import { attachLessonAsset, lessonAssetBytes, standingLessonAsset } from '@/lib/lesson-assets';

/** The three containers the API files, and the only three a `<video>` plays without a plugin. */
const ACCEPT = 'video/mp4,video/quicktime,video/webm';

/** In MB with one decimal: the teacher is comparing it with the cap, not auditing a byte count. */
function sizeLabel(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The video on one page: what stands there now, a new take going up, and the same bytes coming
 * back into a player.
 *
 * Two things about this block are decisions rather than conveniences. The file goes up as a
 * multipart body and comes down as a Blob the portal hands the player an address for — the API
 * never sends a URL for a recording, so a paid page's bytes have no address to share
 * (ARCHITECTURE §6). And a second upload is the whole replace: the API retires the recording it
 * supersedes rather than this screen asking for a delete first, so there is no moment where a
 * page has lost its video and not yet gained the new one.
 *
 * It reads its own state because it is mounted per lesson. The list of lessons carries no field
 * for a recording, and a screen that guessed whether a page had one would be wrong the moment a
 * teacher uploaded in another tab.
 */
export function LessonRecording({ moduleId, lessonId }: { moduleId: string; lessonId: string }) {
  const [asset, setAsset] = useState<LessonAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadFailed(false);

    standingLessonAsset(moduleId, lessonId)
      .then((standing) => {
        if (alive) setAsset(standing);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [moduleId, lessonId, attempt]);

  // An object URL is a lease, not a value: left unreleased the bytes it names stay in memory for
  // the rest of the tab's life, so every swap and every unmount hands it back.
  useEffect(() => {
    if (!playerUrl) return;
    return () => {
      URL.revokeObjectURL(playerUrl);
    };
  }, [playerUrl]);

  async function upload(file: File): Promise<void> {
    setUploading(true);
    setFileError(null);
    try {
      const attached = await attachLessonAsset(moduleId, lessonId, file);
      setAsset(attached);
      setPlayerUrl(null);
      notify.success('Recording attached');
    } catch (error) {
      // The size and the container are decided by the API against its own lookup, so the only
      // honest message is the one it sent, put where the teacher just clicked.
      const reason = fieldErrors(error).file?.[0];
      if (reason) setFileError(reason);
      else notify.error(describeFailure(error));
    } finally {
      setUploading(false);
    }
  }

  async function play(): Promise<void> {
    if (playerUrl) {
      setPlayerUrl(null);
      return;
    }

    setPlaying(true);
    try {
      const bytes = await lessonAssetBytes(moduleId, lessonId);
      setPlayerUrl(URL.createObjectURL(bytes));
    } catch (error) {
      notify.error(describeFailure(error));
    } finally {
      setPlaying(false);
    }
  }

  function choose(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    // Cleared whatever happens next, so picking the same file again after a refusal is still a
    // change event rather than nothing happening at all.
    event.target.value = '';
    if (file && !uploading) void upload(file);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-label text-ink-muted">The recording</span>

        <div className="flex items-center gap-1">
          {asset && !loading && !loadFailed ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={playing}
              disabled={uploading}
              onClick={() => void play()}
            >
              {playerUrl ? 'Hide' : 'Play'}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={uploading}
            disabled={loading || loadFailed}
            onClick={() => picker.current?.click()}
          >
            {asset ? 'Replace' : 'Attach a recording'}
          </Button>
          <input
            ref={picker}
            // Named for what it is rather than left nameless: this is the control a refusal and a
            // screen reader both have to point at.
            aria-label="Recording file"
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={uploading}
            onChange={choose}
          />
        </div>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-[0.8125rem] text-ink-faint">
          <Spinner size="sm" label="Loading the recording" />
          Checking what this page carries
        </p>
      ) : null}

      {loadFailed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[0.8125rem] text-ink-muted">The recording did not load.</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : null}

      {!loading && !loadFailed && asset ? (
        <p className="flex flex-wrap items-baseline gap-x-2 text-[0.8125rem]">
          <span className="text-ink">{asset.displayName}</span>
          <span className="text-ink-faint">{sizeLabel(asset.bytes)}</span>
        </p>
      ) : null}

      {!loading && !loadFailed && !asset ? (
        <p className="text-[0.8125rem] text-ink-faint">No recording on this page yet.</p>
      ) : null}

      {fileError ? (
        <p role="alert" className="text-[0.8125rem] text-danger">
          {fileError}
        </p>
      ) : null}

      <p className="text-[0.75rem] leading-snug text-ink-faint">
        MP4, MOV or WebM. The bytes are filed against this page and handed out only by it, so a
        student needs the same right to read the page that they do to watch it.
      </p>

      {playerUrl ? (
        <video
          controls
          src={playerUrl}
          aria-label={`Preview of ${asset?.displayName ?? 'the recording'}`}
          className="w-full max-w-2xl rounded-card border border-line bg-paper-sunk"
        />
      ) : null}
    </div>
  );
}
