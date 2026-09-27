import { HttpStatus, NotFoundException } from '@nestjs/common';
import { API_ERROR_CODES } from '@lms/shared';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';

import { MissingStoredObjectError, type ByteWindow } from '../../providers/storage/storage.port';
import { resolveByteRange } from './byte-range';

/**
 * A recording, stated as the three things a ranged response needs, and addressed through whoever
 * already decided the caller may have it.
 *
 * This is not a row. `open` is the store's own read with its key already chosen, so the key never
 * reaches anything that answers a client, and the length travels as a number rather than as a
 * `stat` the caller has to trust: the row named the size when the upload landed, and a store whose
 * bytes have since changed length is a broken store rather than a fact about this response.
 */
export interface LessonVideo {
  contentType: string;
  bytes: number;
  /** The window this caller asked for, or every byte when the header said nothing usable. */
  open(window?: ByteWindow): Promise<Readable>;
}

/** The one message for a recording this caller cannot have because there is none to have.
 *
 * It covers a page with nothing attached and a page whose row names bytes the store has lost —
 * which are the same thing to anybody watching, and telling them apart would be telling a client
 * about a filesystem it has no business knowing. */
export function missingRecording(): NotFoundException {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'We cannot find that recording.',
  });
}

/**
 * Answer a request for a recording: the whole of it, the piece the player asked for, or the
 * refusal that says the piece is past the end.
 *
 * The order is the one thing worth reading here. The bytes are opened *before* a single header
 * goes out, so a failure on the way to the file can still be the API's normal JSON error — and
 * once headers are moving, they cannot be taken back, which is why the error handling after the
 * pipe is quiet. A stream that answers with a 200 and then dies halfway is indistinguishable from
 * a complete file to most players, so the whole response is decided up front from numbers the row
 * already holds.
 *
 * `Accept-Ranges` is said on every answer, including the full one: it is what tells a player that
 * asking for a piece next time is worth doing, and a server that only says it when it happens to
 * be slicing is a server no player believes.
 */
export async function streamLessonVideo(
  video: LessonVideo,
  req: Request,
  res: Response,
): Promise<void> {
  const decision = resolveByteRange(req.headers.range, video.bytes);

  res.setHeader('Accept-Ranges', 'bytes');
  // Nobody keeps a gated file: not a shared cache, which would hand these bytes to the next
  // visitor, and not a browser's HTTP cache, which is not a place a paid recording should sit in
  // while its owner's enrollment quietly ends.
  res.setHeader('Cache-Control', 'private, no-store');

  if (decision.mode === 'past-end') {
    // The length is the whole of this answer. A player that asked past the end believes the file
    // is longer than it is, and `*` is the one number that corrects it.
    res.status(416).setHeader('Content-Range', `bytes */${video.bytes}`).end();
    return;
  }

  const window = decision.mode === 'window' ? decision.window : undefined;
  const body = await video.open(window).catch((thrown: unknown) => {
    if (thrown instanceof MissingStoredObjectError) throw missingRecording();
    throw thrown;
  });

  const start = window?.start ?? 0;
  const end = window?.end ?? video.bytes - 1;
  const length = end - start + 1;

  res.status(window ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK);
  res.setHeader('Content-Type', video.contentType);
  res.setHeader('Content-Length', String(length));
  if (window) {
    res.setHeader('Content-Range', `bytes ${start}-${end}/${video.bytes}`);
  }

  try {
    await pipeline(body, res);
  } catch (thrown) {
    // Past this point the answer has already left, so there is nothing to send and a status to
    // leave alone. The ordinary cause is a tab closed or a scrubber moved on — a read that was
    // abandoned, which like any read leaves nothing behind to clean up. Anything else that could
    // raise here has already been named in the response the client is no longer reading.
    body.destroy();
    if (!res.headersSent) throw thrown;
    res.end();
  }
}
