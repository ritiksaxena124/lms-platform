import type { ByteWindow } from '../../providers/storage/storage.port';

/**
 * What a `Range` header is asking for, worked out against the length of the file.
 *
 * The arithmetic lives here rather than in a route because it is the part of ranged serving a
 * client can get wrong and the server must not: a player mid-seek sends whatever byte it wants,
 * and the answer has to be either exactly the window it named or a refusal that says so — never a
 * file that starts somewhere other than where the header said. `Content-Range` is a promise about
 * the whole object, so the length is an input to this rather than something the reader has to
 * know: the row that names a recording already says how long it is.
 *
 * RFC 9110 draws the line this function keeps. A range that is *malformed* is not a request the
 * server can honour or refuse, so it is ignored and the caller sends the whole object; a range
 * that is well-formed but names bytes past the end is a real question with a real answer, and the
 * answer is 416. Collapsing the two would either make a broken client's request fail or let a
 * player that has outgrown a file believe the file is empty.
 */
export type ByteRangeDecision =
  /** Nothing usable was asked for: send every byte, and answer `200` as if no header arrived. */
  | { mode: 'whole' }
  | { mode: 'window'; window: ByteWindow }
  /** Well-formed, and beginning past the last byte the file has. */
  | { mode: 'past-end' };

/** One range, spelled the three ways a client spells it: `start-end`, `start-`, and `-suffix`. */
const SINGLE_RANGE = /^bytes=(\d*)(?:-(\d*))?$/i;

export function resolveByteRange(
  header: string | undefined,
  totalBytes: number,
): ByteRangeDecision {
  if (!header) return { mode: 'whole' };

  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) {
    // Includes another unit than `bytes`, a malformed number, a reversed pair, and a list of
    // ranges — which is answerable only with a `multipart/byteranges` body no media player this
    // platform serves has ever asked for.
    return { mode: 'whole' };
  }

  // A range that left out one of its numbers has that half absent rather than empty, and the
  // difference is only in how the regular expression reports it.
  const [first = '', last = ''] = match.slice(1);
  if (first === '' && last === '') return { mode: 'whole' };

  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0) return { mode: 'past-end' };
    // A suffix range is a client saying "however long it is, give me the end of it" — which is
    // why the length belongs to the server: this is how a player finds an MP4's trailer.
    return {
      mode: 'window',
      window: { start: Math.max(0, totalBytes - suffix), end: totalBytes - 1 },
    };
  }

  const start = Number(first);
  if (start >= totalBytes) return { mode: 'past-end' };
  const end = last === '' ? totalBytes - 1 : Math.min(Number(last), totalBytes - 1);
  if (end < start) return { mode: 'whole' };

  return { mode: 'window', window: { start, end } };
}
