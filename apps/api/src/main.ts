import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { configureApp } from './app.configure';
import { AppModule } from './app.module';
import { API_PREFIX } from './common/http/api-prefix';
import { AppLogger } from './common/logging/app-logger.service';
import { provideEnv } from './config/env.module';

async function bootstrap(): Promise<void> {
  // Validate configuration before the container is built: a bad env should fail loudly.
  const env = provideEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app, env);
  app.useLogger(app.get(AppLogger));

  await app.listen(env.PORT, '127.0.0.1');
  Logger.log(`API listening on ${env.API_PUBLIC_URL}${API_PREFIX} (port ${env.PORT})`, 'Bootstrap');
}

void bootstrap();
