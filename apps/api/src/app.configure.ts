import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

import { API_PREFIX } from './common/http/api-prefix';
import { createRequestContextMiddleware } from './common/http/request-context.middleware';
import { AppLogger } from './common/logging/app-logger.service';
import type { AppEnv } from './config/env';

/**
 * The HTTP pipeline shared by `main.ts` and the integration tests, so what is tested is
 * what ships: same prefix, same CORS allowlist, same validation behaviour.
 */
export function configureApp(app: INestApplication, env: AppEnv): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  app.use(createRequestContextMiddleware(app.get(AppLogger)));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
  });

  // Unknown properties are stripped and rejected, so a client cannot smuggle e.g.
  // `isActive: true` into a create/update payload.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableShutdownHooks();

  return app;
}
