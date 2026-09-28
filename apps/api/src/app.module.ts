import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HealthModule } from './common/health/health.module';
import { AppLogger } from './common/logging/app-logger.service';
import { PrismaModule } from './common/prisma/prisma.module';
import { EnvModule } from './config/env.module';
import { AuthModule } from './modules/auth/auth.module';
import { ActionLogModule } from './modules/action-log/action-log.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CourseModule } from './modules/course/course.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TeacherModule } from './modules/teacher/teacher.module';
import { StorageModule } from './providers/storage/storage.module';
import { ReferenceModule } from './reference/reference.module';

@Module({
  imports: [
    EnvModule,
    PrismaModule,
    HealthModule,
    ReferenceModule,
    AuthModule,
    TeacherModule,
    CourseModule,
    CatalogModule,
    EnrollmentsModule,
    AvailabilityModule,
    BookingsModule,
    // The queue a send decision is filed in. Registered so the two modules above can hand their
    // news to it; the sweep that reads it back out arrives with 6e.
    NotificationsModule,
    // The record every standing-row write files beside itself. Registered here so the feature
    // modules can hand it their transactions; it owns a table and no connections of its own.
    ActionLogModule,
    // The port behind every uploaded byte, selected by `STORAGE_PROVIDER` (§6). Registered
    // before any route uses it, so the provider string is checked at boot rather than on the
    // first upload of a term.
    StorageModule,
    // Coarse default for the POC; auth endpoints get a tighter limit in Phase 2.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    // The one clock the platform runs on its own. Currently only the sweep of class requests
    // nobody answered (`BookingExpiryService`); anything else that has to happen whether or not
    // someone is asking registers here, and each job decides its own schedule.
    ScheduleModule.forRoot(),
  ],
  providers: [
    AppLogger,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
