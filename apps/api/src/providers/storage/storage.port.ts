import type { Readable } from 'node:stream';

/**
 * Where an uploaded file's bytes live, stated without naming a disk, a bucket or a vendor SDK
 * (ARCHITECTURE §6). A lesson's recording is written once and read many times by people who
 * have already been told they may watch it, which is the whole job this port describes.
 *
 * Two rules are worth naming because they are the ones a caller cannot see from the signature.
 *
 * **The caller mints the key.** Nothing here derives a name from a filename, a lesson id or a
 * timestamp, because every one of those is either a duplicate waiting to happen or a guess a
 * client can make. The endpoint asks for a uuid, appends the extension it recognised, and puts
 * the result in the row that authorises the read.
 *
 * **There is no delete.** A retired asset keeps its bytes for the same reason a retired lesson
 * keeps its row (§2): the file is the record of what the teacher uploaded, and the row that
 * names it survives. When a purge is eventually designed it will be a policy with a retention
 * rule behind it, and a method sitting here inviting callers to skip that thinking.
 *
 * **A read cannot leave anything behind.** A write that dies halfway is undone by the adapter,
 * because those bytes are invisible to the app and immortal on the disk; a read that dies
 * halfway — the tab closed, the seek abandoned, the connection dropped, all of them ordinary —
 * needs nothing of the kind, because the store only ever has the file open to look at it. That
 * asymmetry is why there is no `close` on the stream either, and no cleanup path in a reader.
 */
export const STORAGE = Symbol('STORAGE');

export interface StoredObject {
  /** The name these bytes live under: a relative, slash-separated path the store owns. */
  key: string;
  /** Declared by whoever sent the file. An object store may record it; the authority for it
   * is the row, which is what the read route answers with. */
  contentType: string;
  body: Readable;
}

/**
 * A window inside an object: the offset of its first byte and of its last, both counted from the
 * start of the file. Inclusive at both ends, because that is what a byte range in HTTP means, and
 * an adapter that read one byte short of the end would put a media player a byte out of step in a
 * way only the second half of a file can show.
 */
export interface ByteWindow {
  start: number;
  end: number;
}

export interface Storage {
  /**
   * Write `body` under `key`. Resolves once the last byte is on the store, which is what makes
   * it safe for the caller to write the row afterwards: no request ever names bytes that are
   * still arriving. A key that already holds bytes is a refusal, not a replacement — a second
   * upload under a used key means something reused it, and overwriting a recording somebody
   * may be watching is not how that surfaces.
   */
  put(object: StoredObject): Promise<void>;

  /**
   * A stream over the bytes under `key`, for a route to carry to a person the gates have
   * already accepted. Nothing here decides whether that person may have them, and nothing here
   * hands back a URL: an object store's public link is a second, ungated door to the same file,
   * and the point of this port is that there is only one.
   *
   * `range` asks for a window of them rather than all of them, which is what a seeking player
   * needs — the whole of a two-hour recording for the four seconds under its scrubber is not a
   * slow answer but a wrong one. The caller settles the window against the object's length before
   * asking, because the row that names these bytes already says how long they are; the store is
   * never asked to guess where the end is.
   */
  open(key: string, range?: ByteWindow): Promise<Readable>;
}

/** A key that would put bytes outside the store's own space: absolute, escaping, empty, or
 * built from characters the store does not name things with. Refused before anything opens. */
export class UnsafeStorageKeyError extends Error {
  constructor() {
    super('Storage key must be a plain relative path inside the store');
    this.name = 'UnsafeStorageKeyError';
  }
}

/** The key is well-formed and nothing is stored under it. An answer rather than a failure: the
 * read route turns it into a 404, whereas any other error on the way to a file means the
 * storage itself is not working and nobody should be told the recording is gone. */
export class MissingStoredObjectError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`No stored object under ${key}`);
    this.name = 'MissingStoredObjectError';
    this.key = key;
  }
}
