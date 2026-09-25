import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { configureApp } from '../../src/app.configure';
import { provideEnv } from '../../src/config/env.module';

/**
 * Boots a real module graph through the same HTTP pipeline as production, against the
 * `lms_test` database selected by `.env.test`. Tests exercise the app as it ships,
 * including prefix, CORS, validation and the error envelope.
 */
export async function createTestApp(metadata: ModuleMetadata): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule(metadata).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, provideEnv());
  await app.init();
  return app;
}
