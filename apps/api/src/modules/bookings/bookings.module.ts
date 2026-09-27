import { Module } from '@nestjs/common';

import { AvailabilityModule } from '../availability/availability.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { BookingsController } from './bookings.controller';
import { BookingsRepository } from './bookings.repository';
import { BookingsService } from './bookings.service';

/**
 * A class a student takes with a teacher, and the calendar it is chosen from.
 *
 * This module owns the `booking` table and reads two others through the modules that own them:
 * the week a teacher keeps open (`AvailabilityModule`) and whether the student already holds a
 * place (`EnrollmentsModule`). Neither of those questions belongs here — a window is not a
 * booking, and a place is not a class — and reaching across for their repositories is what keeps
 * this from becoming a second copy of their rules.
 *
 * The slots route derives its grid instead of storing one, which is the reason the two reads
 * above are live rather than a snapshot a teacher's edit would have to keep in step with.
 */
@Module({
  imports: [AvailabilityModule, EnrollmentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsRepository],
})
export class BookingsModule {}
