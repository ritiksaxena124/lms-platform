import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalStorage } from './local-storage.adapter';
import { MissingStoredObjectError, UnsafeStorageKeyError, type Storage } from './storage.port';

/**
 * The local storage adapter on a scratch directory — no HTTP, no database, no vendor.
 *
 * These are the two promises the read and write routes will build on: that a key is where the
 * bytes live and only the caller's key decides that (so a key cannot name a file the store has
 * no business serving), and that bytes already written are never quietly overwritten (so the row
 * that names a key always describes what is behind it). What a *legal* key looks like, how big a
 * file may be and who may read it are the endpoint's rules; this adapter's job is to be a place
 * bytes go that cannot be tricked into being somewhere else.
 */
const chunks = (...texts: string[]) =>
  Readable.from(texts.map((text) => Buffer.from(text, 'utf8')));

const collect = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(parts);
};

let root: string;
let storage: Storage;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'lms-storage-'));
  storage = new LocalStorage({ STORAGE_LOCAL_DIR: root });
});

afterAll(async () => {
  // The scratch directory this test made for itself, and nothing else.
  if (root) await rm(root, { recursive: true, force: true });
});

describe('local storage adapter', () => {
  it('writes the bytes under the key it was given and hands the same bytes back', async () => {
    await storage.put({
      key: 'flat.mp4',
      contentType: 'video/mp4',
      body: chunks('\u0000FTYP', 'isom', '\u0000\u0000free'),
    });

    // Three chunks in, one file out: the body is streamed, so a 200 MB recording never needs
    // 200 MB of heap to be stored. That is the whole reason the port takes a stream rather
    // than a Buffer — an upload that buffers would work in a test and fall over in production.
    expect(await readFile(join(root, 'flat.mp4'), 'utf8')).toBe('\u0000FTYPisom\u0000\u0000free');

    const opened = await storage.open('flat.mp4');
    expect((await collect(opened)).toString('utf8')).toBe('\u0000FTYPisom\u0000\u0000free');
  });

  it('hands back one window of a file, both ends of it included', async () => {
    await storage.put({
      key: 'seekable.mp4',
      contentType: 'video/mp4',
      body: chunks('0123456789', 'abcdefghij'),
    });

    // A player seeking asks for bytes 4 to 7 of a recording, and the answer has to be exactly
    // four bytes long: `end` inclusive is what the `Content-Range` header a browser is being
    // shown promises, and a store that read four bytes starting at the fifth would put the
    // whole stream out of position by one.
    const slice = await storage.open('seekable.mp4', { start: 4, end: 7 });
    expect((await collect(slice)).toString('utf8')).toBe('4567');

    // The read left nothing behind. A ranged read that could truncate or append would make a
    // client's abandoned seek — a tab closed mid-stream, which is the ordinary case — a way to
    // damage a recording, so this is the sentence the no-cleanup-on-read decision rests on.
    expect(await readFile(join(root, 'seekable.mp4'), 'utf8')).toBe('0123456789abcdefghij');
  });

  it('makes room for a key whose directories nobody created', async () => {
    await storage.put({
      key: 'lessons/2026/09/pie.mp4',
      contentType: 'video/mp4',
      body: chunks('a'),
    });

    // The endpoint namespaces keys by lesson so one teacher's directory does not hold every
    // file ever uploaded; an adapter that required the tree to exist first would fail on the
    // first upload of every new course.
    expect(await readFile(join(root, 'lessons', '2026', '09', 'pie.mp4'), 'utf8')).toBe('a');
  });

  it('will not write over bytes that already have a key', async () => {
    await storage.put({
      key: 'taken.mp4',
      contentType: 'video/mp4',
      body: chunks('the first recording'),
    });

    // Two rows can never share a key (the unique index says so), so arriving here with a key
    // already on disk means something reused one — and the answer has to be a refusal, not a
    // silent replacement of a recording a student may be watching right now.
    await expect(
      storage.put({ key: 'taken.mp4', contentType: 'video/mp4', body: chunks('the second') }),
    ).rejects.toThrow();

    expect(await readFile(join(root, 'taken.mp4'), 'utf8')).toBe('the first recording');
  });

  it('leaves nothing behind when the body it was writing dies midway', async () => {
    function* interruptedUpload(): Generator<Buffer> {
      yield Buffer.from('the beginning of a recording');
      throw new Error('the upload was cut off');
    }

    const written = storage.put({
      key: 'lessons/cut-off.mp4',
      contentType: 'video/mp4',
      body: Readable.from(interruptedUpload()),
    });

    await expect(written).rejects.toThrow('the upload was cut off');

    // The hole the write left is the part that matters. A half-written file under a key nobody
    // filed is invisible to the app and immortal on the disk, and if the key were reused the
    // `wx` above would refuse a teacher's retry. An unfinished write is an unfinished write.
    await expect(stat(join(root, 'lessons', 'cut-off.mp4'))).rejects.toThrow();
  });

  it('refuses a key that names somewhere other than its own directory', async () => {
    const before = await readdir(root);

    const attempts = [
      '../escaped.mp4',
      'lessons/../../escaped.mp4',
      '/etc/passwd',
      'C:\\Windows\\repair.mp4',
      'lessons//double.mp4',
      'lessons/./same.mp4',
      'name with spaces.mp4',
      '',
    ];

    for (const key of attempts) {
      await expect(
        storage.put({ key, contentType: 'video/mp4', body: chunks('x') }),
      ).rejects.toThrow(UnsafeStorageKeyError);
    }

    // Refused before anything was opened, so the directory is exactly as it was — and the file
    // the first attempt wanted to write does not exist two levels up.
    expect(await readdir(root)).toEqual(before);
    await expect(stat(join(root, '..', 'escaped.mp4'))).rejects.toThrow();
  });

  it('answers a key with no bytes behind it in its own words', async () => {
    const error = await storage.open('never-written.mp4').catch((thrown: unknown) => thrown);

    // A route cannot turn a raw ENOENT into a clean 410 without matching on a filesystem code,
    // and the port is where that distinction belongs: "no such object" is an answer, "the disk
    // is on fire" is not.
    expect(error).toBeInstanceOf(MissingStoredObjectError);
    expect((error as MissingStoredObjectError).key).toBe('never-written.mp4');
    // and it names the key the caller already had, never the path it would have read — an
    // internal filesystem location has no business in a response body or a log line.
    expect((error as Error).message).not.toContain(root);
  });

  it('refuses to open a key it would refuse to write', async () => {
    await expect(storage.open('../../etc/passwd')).rejects.toThrow(UnsafeStorageKeyError);
    // Including on the way a seek comes in: a window is an argument to the same read, not a
    // second door with its own rules about what a key may name.
    await expect(storage.open('../../etc/passwd', { start: 0, end: 8 })).rejects.toThrow(
      UnsafeStorageKeyError,
    );
  });

  it('does not touch the disk until something is written', async () => {
    const waiting = join(root, 'not-yet-made');
    const quiet = new LocalStorage({ STORAGE_LOCAL_DIR: waiting });

    // Boot must not need write access to the upload directory: the API starts in front of a
    // health check, and a container that has not mounted its volume yet is still a container
    // that should answer `/health`. Only a `put` earns a `mkdir`.
    expect(quiet).toBeInstanceOf(LocalStorage);
    await expect(stat(waiting)).rejects.toThrow();
  });
});
