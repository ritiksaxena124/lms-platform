import { Global, Module } from '@nestjs/common';

import { parseEnv, type AppEnv } from './env';

export const ENV = Symbol('ENV');

export function provideEnv(): AppEnv {
  return parseEnv(process.env);
}

/** Typed, validated configuration available everywhere without re-reading process.env. */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: provideEnv }],
  exports: [ENV],
})
export class EnvModule {}
