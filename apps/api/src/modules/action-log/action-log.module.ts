import { Module } from '@nestjs/common';

import { ActionRecorder } from './action-recorder';

/**
 * The record the platform keeps of its own writes (§7).
 *
 * One provider, and it is deliberately the smallest module in the API: Phase 7 owns a table and the
 * rules about what may be filed in it, and nothing else. It imports no other module because the
 * recorder writes through the *caller's* transaction — it never reaches for a client of its own, so
 * there is no `PrismaModule` here to import for a connection nobody uses.
 *
 * Every feature module that writes a standing row will import this one, and none of them will be
 * able to tell the recorder which part of the app it was, what table it touched, or who was asking.
 * The first two are answered by the action's shape in `@lms/shared`, the third by the request that
 * `JwtAuthGuard` already resolved.
 */
@Module({
  providers: [ActionRecorder],
  exports: [ActionRecorder],
})
export class ActionLogModule {}
