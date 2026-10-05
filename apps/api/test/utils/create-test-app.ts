import type { INestApplication, InjectionToken, ModuleMetadata } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';

import { configureApp } from '../../src/app.configure';
import { provideEnv } from '../../src/config/env.module';

/** A port a spec wants to answer for itself, as the token the module exports and the object to put
 * behind it: `[PAYMENT, new MockPayment()]`. */
export type ProviderOverride = readonly [token: InjectionToken, value: unknown];

/** Spelled out rather than imported from the service, because a renamed job is a job ops cannot
 * find — and the same reason the name is written by hand in the spec that proves it is registered. */
const MAIL_DELIVERY_CRON = 'mail-outbox-delivery';

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
  stopTheSweep(app);
  return app;
}

/**
 * The delivery sweep is stopped in every spec process, and this is the one place that says why.
 *
 * The job fires on the wall clock, so it does not care which process is holding it: four spec
 * processes share one `lms_test`, each with a graph that registers the cron, and every five minutes
 * each of them claims the due rows of the whole queue. A sweep is therefore not a thing one test can
 * opt out of — the run that disturbs a fixture is usually somebody else's. The rows it disturbs are
 * the ones a suite filed as its own examples and is about to read back, and on the test transport
 * (`none`) a run does not even mail them: it drops them.
 *
 * Stopped rather than deleted, because registration is a production fact worth asserting: the spec
 * that owns the sweep still reads the job out of the registry and checks the clock it sits on.
 * Nothing that *calls* the sweep depends on this — every delivery test runs it directly, with a
 * transport it supplied and a `now` it chose, which is the only way a retry curve is answerable.
 */
function stopTheSweep(app: INestApplication): void {
  const scheduler = app.get(SchedulerRegistry);
  if (!scheduler.doesExist('cron', MAIL_DELIVERY_CRON)) return;
  void scheduler.getCronJob(MAIL_DELIVERY_CRON).stop();
}
