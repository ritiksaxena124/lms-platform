import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { EnvModule } from '../../config/env.module';
import { LocalStorage } from './local-storage.adapter';
import { buildStorage, StorageModule } from './storage.module';
import { STORAGE, type Storage } from './storage.port';

/**
 * Which adapter the environment asks for, and what happens when it asks for one that has not
 * been written. The port is only worth having if the choice is made in exactly one place, and
 * this is the spec that pins that place down: a route injected with `STORAGE` should not also
 * have to know whether the box it runs on keeps files on its own disk.
 */
describe('storage provider selection', () => {
  it('builds the local adapter for the provider the environment names', () => {
    const storage = buildStorage({
      STORAGE_PROVIDER: 'local',
      STORAGE_LOCAL_DIR: './storage/uploads',
    });

    expect(storage).toBeInstanceOf(LocalStorage);
  });

  it('refuses a provider it has no adapter for, rather than quietly using the local disk', () => {
    // The fall-through is the dangerous direction: `STORAGE_PROVIDER=s3` on a box that has no
    // bucket configured would write real recordings into a directory nobody is budgeting for
    // or backing up, and every row would look like a success. Boot refuses for the same
    // reason (§6); this says the port would too if it were reached first.
    expect(() =>
      buildStorage({ STORAGE_PROVIDER: 's3', STORAGE_LOCAL_DIR: './storage/uploads' }),
    ).toThrow(/s3/i);
  });

  it('hands the port to anything that asks for it by token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule, StorageModule],
    }).compile();

    // The whole application imports this module, so an injected `STORAGE` is the same object
    // everywhere — one place to swap when the bytes move to a bucket.
    expect(moduleRef.get<Storage>(STORAGE)).toBeInstanceOf(LocalStorage);
  });
});
