import type { INestApplication, InjectionToken, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { configureApp } from '../../src/app.configure';
import { provideEnv } from '../../src/config/env.module';

/** A port a spec wants to answer for itself, as the token the module exports and the object to put
 * behind it: `[PAYMENT, new MockPayment()]`. */
export type ProviderOverride = readonly [token: InjectionToken, value: unknown];

/**
 * Boots a real module graph through the same HTTP pipeline as production, against the
 * `lms_test` database selected by `.env.test`. Tests exercise the app as it ships,
 * including prefix, CORS, validation and the error envelope.
 *
 * `overrides` exists for the ports whose shipped adapter cannot give a test the answer it needs:
 * `PAYMENT_PROVIDER=mock` settles every charge, so the refused one and the deployment that takes no
 * money at all can only be walked by standing something else behind the token. A spec that overrides
 * a port is naming the answer it is testing rather than the environment that would produce it, which
 * is also why nothing here reaches for `process.env`.
 */
export async function createTestApp(
  metadata: ModuleMetadata,
  overrides: readonly ProviderOverride[] = [],
): Promise<INestApplication> {
  let builder = Test.createTestingModule(metadata);
  for (const [token, value] of overrides) {
    builder = builder.overrideProvider(token).useValue(value);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, provideEnv());
  await app.init();
  return app;
}
