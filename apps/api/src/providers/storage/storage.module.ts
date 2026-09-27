import { Module } from '@nestjs/common';

import type { AppEnv } from '../../config/env';
import { ENV } from '../../config/env.module';
import { LocalStorage } from './local-storage.adapter';
import { STORAGE, type Storage } from './storage.port';

/** The part of the environment this choice needs — spelled out so a test can name a provider
 * without inventing a whole config. */
export type StorageEnv = Pick<AppEnv, 'STORAGE_PROVIDER' | 'STORAGE_LOCAL_DIR'>;

/**
 * The one place a provider string becomes an object.
 *
 * `STORAGE_PROVIDER=s3` already stops the API from booting (§6), so the second branch is a
 * belt on existing suspenders — but it is here because the day someone writes the bucket
 * adapter, the change is a line in this function plus an adapter class, and nothing in the
 * routes notices. An unrecognised value refusing loudly is the point: falling through to the
 * local disk would store real recordings where nobody is budgeting for them.
 */
export function buildStorage(env: StorageEnv): Storage {
  if (env.STORAGE_PROVIDER === 'local') return new LocalStorage(env);

  throw new Error(
    `Storage provider "${env.STORAGE_PROVIDER}" has no adapter yet; set STORAGE_PROVIDER=local`,
  );
}

@Module({
  providers: [
    {
      provide: STORAGE,
      useFactory: (env: AppEnv) => buildStorage(env),
      inject: [ENV],
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
