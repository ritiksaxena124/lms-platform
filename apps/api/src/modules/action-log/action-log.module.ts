import { Module } from '@nestjs/common';

import { ActionLogController } from './action-log.controller';
import { ActionLogRepository } from './action-log.repository';
import { ActionLogService } from './action-log.service';
import { ActionRecorder } from './action-recorder';

/**
 * The record the platform keeps of its own writes (§7).
 *
 * Two halves, and they share a table rather than a job. `ActionRecorder` is the writer, and it is
 * still the smallest thing in the API: it imports no module and holds no connection of its own,
 * because it writes through the *caller's* transaction. `ActionLogService` is the reader, and it
 * needs a connection — which arrives through the global `PrismaModule`, so there is still no import
 * here — and never reaches into a transaction that is not its own.
 *
 * The reader exists because a log nobody can ask a question about is a table. It answers only ops,
 * and it changes no answer the writer filed: the section, the target and the actor come back as the
 * action's own shape decided them at the time.
 *
 * Every feature module that writes a standing row will import this one, and none of them will be
 * able to tell the recorder which part of the app it was, what table it touched, or who was asking.
 * The first two are answered by the action's shape in `@lms/shared`, the third by the request that
 * `JwtAuthGuard` already resolved.
 */
@Module({
  controllers: [ActionLogController],
  providers: [ActionRecorder, ActionLogRepository, ActionLogService],
  exports: [ActionRecorder],
})
export class ActionLogModule {}
