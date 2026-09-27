import { randomUUID } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { BadRequestException, HttpException, PayloadTooLargeException } from '@nestjs/common';
import { API_ERROR_CODES } from '@lms/shared';
import type { Request, Response } from 'express';
import multer from 'multer';

import type { Storage } from '../../providers/storage/storage.port';

/**
 * Reading one multipart body, and the order it is read in.
 *
 * This is the only place in the API where a request costs disk, so it is the one place where
 * the sequence has to be deliberate: the caller is authorised and the page is proved to be
 * theirs *before* this runs, the bytes stream straight into the storage port (never a buffer,
 * never a temporary file the framework picks), and nothing is filed as a record until the
 * write has finished. A refusal partway through leaves no row and no file, because the adapter
 * erases a write that never completed and the cap cuts the stream at the limit rather than
 * reading a body to the end before saying no.
 *
 * The name the client sent is display text and nothing else. It is never joined onto a path —
 * the key the bytes land under is minted here from the page's id and a uuid, which is the whole
 * defence. Busboy also strips the sender's directories, and that is worth having, but it is a
 * nicety whose result depends on the server's idea of a separator, so nothing builds on it.
 */

/** The containers a browser plays in a `<video>` element with no plugin and no transcoder in
 * front of it, and the extension each one is stored under. Anything else would be a file the
 * platform took the trouble to keep and then could not show. */
const PLAYABLE_TYPES: ReadonlyMap<string, string> = new Map([
  ['video/mp4', 'mp4'],
  ['video/quicktime', 'mov'],
  ['video/webm', 'webm'],
]);

const FILE_FIELD = 'file';

const WRONG_TYPE = 'Send an MP4, MOV or WebM recording.';
const NO_FILE = 'Attach the recording you want on this page.';
const WRONG_FIELD = 'Attach one file, in a field named "file".';

/** What landed in the store, and what the row about it needs to say. */
export interface AcceptedUpload {
  key: string;
  displayName: string;
  contentType: string;
  bytes: number;
}

export interface UploadTarget {
  /** The page the bytes belong to: the key is namespaced by it, so one teacher's recordings do
   * not pile into a directory shared by everybody's. */
  lessonId: string;
  storage: Storage;
  maxUploadMb: number;
}

function fieldProblem(message: string): BadRequestException {
  return new BadRequestException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Check the highlighted fields.',
    details: { validation: { [FILE_FIELD]: [message] } },
  });
}

/** Too big is a field problem with its own status: the form highlights the same box, and a
 * client that has to retry with a smaller file needs a 413 to know that is what happened. */
function tooLargeProblem(message: string): PayloadTooLargeException {
  return new PayloadTooLargeException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Check the highlighted fields.',
    details: { validation: { [FILE_FIELD]: [message] } },
  });
}

/**
 * Counts bytes on their way to the store and cuts the stream at the cap.
 *
 * Deliberately not multer's `limits.fileSize`: that hands the number to busboy, which
 * truncates the part and ends the stream cleanly — a recording that stops in the middle and
 * looks like a finished one. Erroring here fails the write on purpose, so the adapter removes
 * what it had started and the row is never written.
 */
class CappedStream extends Transform {
  bytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly overTheCap: () => HttpException,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      callback(this.overTheCap());
      return;
    }
    callback(null, chunk);
  }
}

/** `2 MB`, `15 MB` — the cap in the unit the setting is written in, so a refusal quotes the
 * number the teacher's form was told about. */
function sizeLabel(maxUploadMb: number): string {
  return `${maxUploadMb} MB`;
}

export function readLessonVideo(
  req: Request,
  res: Response,
  target: UploadTarget,
): Promise<AcceptedUpload> {
  const maxBytes = target.maxUploadMb * 1024 * 1024;
  const label = sizeLabel(target.maxUploadMb);

  return new Promise((resolve, reject) => {
    let accepted: AcceptedUpload | undefined;

    const engine: multer.StorageEngine = {
      _handleFile(_request, file, callback): void {
        // The extension comes from the declared type, never from the name: a file called
        // `lecture.mp4` that is not one is refused, and one called `lecture.txt` that is gets
        // stored as the video it is.
        const extension = PLAYABLE_TYPES.get(file.mimetype);
        if (!extension) {
          callback(fieldProblem(WRONG_TYPE));
          return;
        }

        const key = `lessons/${target.lessonId}/${randomUUID()}.${extension}`;
        const capped = new CappedStream(maxBytes, () =>
          tooLargeProblem(`A lesson video has to be ${label} or smaller.`),
        );

        const stored = target.storage.put({
          key,
          contentType: file.mimetype,
          body: capped,
        });

        void (async () => {
          try {
            await pipeline(file.stream, capped);
            await stored;
            accepted = {
              key,
              displayName: file.originalname,
              contentType: file.mimetype,
              bytes: capped.bytes,
            };
            callback(null, { size: capped.bytes });
          } catch (thrown) {
            // Wait for the store to finish undoing the write before the request is answered:
            // "a refusal leaves nothing" has to be true by the time the client reads it.
            await stored.catch(() => undefined);
            callback(thrown instanceof Error ? thrown : new Error('The upload could not be read.'));
          }
        })();
      },

      /**
       * Multer's cleanup hook, for the case it reaches here: a request that carried a second
       * file after one had already been stored in full. The port has no delete — forgetting
       * bytes is not something a route is allowed to decide — so those bytes stay unreferenced
       * rather than quietly removed, which is the same trade the store makes for a retired
       * recording. Nothing can read them: no row was ever filed.
       */
      _removeFile(_request, _file, callback): void {
        callback(null);
      },
    };

    const parse = multer({
      storage: engine,
      // Filenames arrive as UTF-8 bytes with no charset declared, which multer would otherwise
      // read as latin1: a teacher's `लेक्चर.mp4` would be stored as mojibake.
      defParamCharset: 'utf8',
    }).single(FILE_FIELD);

    parse(req, res, (thrown?: unknown) => {
      if (thrown) {
        // A multer complaint is about the shape of the request — a file in a field nobody
        // named, a second file, a nameless part — so it leaves as a form error. Everything
        // else, including this module's own refusals and a disk that filled up, travels
        // unchanged: dressing a real fault up as a mistake in the teacher's file would only
        // send them to try the same upload again.
        if (thrown instanceof multer.MulterError) {
          reject(fieldProblem(WRONG_FIELD));
          return;
        }
        reject(thrown instanceof Error ? thrown : new Error('The upload could not be read.'));
        return;
      }
      if (!accepted) {
        reject(fieldProblem(NO_FILE));
        return;
      }
      resolve(accepted);
    });
  });
}
