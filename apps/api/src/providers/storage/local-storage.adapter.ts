import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';

import type { AppEnv } from '../../config/env';
import {
  MissingStoredObjectError,
  type Storage,
  type StoredObject,
  UnsafeStorageKeyError,
} from './storage.port';

/**
 * The one thing a key is allowed to look like: segments of letters, digits, dots, dashes and
 * underscores, joined by slashes. Everything the endpoint will ever mint (a uuid and an
 * extension, under a `lessons/` prefix) fits, and everything that could mean somewhere else
 * does not — `..`, an absolute path, a Windows drive, a backslash, an empty or doubled
 * separator. Checking the alphabet is enough to make `join` safe, because no accepted segment
 * can carry a separator or a drive letter; the store's root is never part of the key.
 */
const KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;

function keySegments(key: string): string[] {
  const segments = key.split('/');
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '.' || segment === '..' || !KEY_SEGMENT.test(segment))
  ) {
    throw new UnsafeStorageKeyError();
  }
  return segments;
}

/**
 * Bytes on the same disk as the API, under `STORAGE_LOCAL_DIR`.
 *
 * This is the adapter a single-VPS deployment runs on, and it is deliberately unglamorous: the
 * port above is what the routes talk to, so moving to a bucket is a second class and an env
 * change rather than a search for every place a path was built. Two things are true of either
 * adapter and are the reason the read gate lives above them — a file here has no URL of its
 * own, and a name nobody can guess is not the same thing as a permission.
 *
 * Writes stream (`put`) and reads stream (`open`), so the box never holds a whole recording in
 * memory; the size a teacher may upload is the boundary's decision, not this one.
 */
@Injectable()
export class LocalStorage implements Storage {
  private readonly root: string;

  constructor(env: Pick<AppEnv, 'STORAGE_LOCAL_DIR'>) {
    this.root = env.STORAGE_LOCAL_DIR;
  }

  private pathFor(key: string): string {
    return join(this.root, ...keySegments(key));
  }

  async put({ key, body }: StoredObject): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });

    // `wx`: fail if the bytes are already there.
    const sink = createWriteStream(path, { flags: 'wx' });
    // Whether *this* call is the one that made the file. `open` fires once the fd exists, so a
    // collision with someone else's key never reaches the unlink below — deleting the recording
    // that refused to be overwritten would be the worst possible answer to a failed write.
    let opened = false;
    sink.on('open', () => {
      opened = true;
    });

    try {
      await pipeline(body, sink);
    } catch (thrown) {
      // The write stopped early: the tab closed, the connection dropped, or the route cut the
      // stream at the size cap. Those bytes are invisible to the app — no row names them — and
      // would stay on the disk forever, so an unfinished upload is undone rather than left as
      // a leak that nothing can clean up later.
      if (opened) await unlink(path).catch(() => undefined);
      throw thrown;
    }
  }

  async open(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    try {
      await access(path);
    } catch {
      throw new MissingStoredObjectError(key);
    }
    return createReadStream(path);
  }
}
