import { Module } from '@nestjs/common';

import { AvailabilityController } from './availability.controller';
import { AvailabilityRepository } from './availability.repository';
import { AvailabilityService } from './availability.service';

/**
 * When a teacher is open for classes.
 *
 * This is the teacher's own week, which is a different thing from a course and a different thing
 * again from a booking: a rule says `Monday 09:00–10:30, in thirty-minute classes`, and it says
 * nothing about which course those minutes eventually carry or who takes them. Keeping it in its
 * own module is what lets 4e derive slots from several courses' worth of windows without either
 * side needing to know about the other's table.
 *
 * The service holds the three rules that make a window a window — closes after it opens, a class
 * fits inside it, no two cover the same minute. The columns accept any integers on purpose
 * (`availability-schema.spec.ts` pins that), because range and overlap are questions about a set
 * of rows, and a database CHECK could only answer them for one row at a time.
 */
@Module({
  controllers: [AvailabilityController],
  providers: [AvailabilityService, AvailabilityRepository],
  // A slot is a window expanded into instants, so the booking calendar reads these rows through
  // the repository that owns them rather than reaching for the table and re-deciding what
  // "standing" means.
  exports: [AvailabilityRepository],
})
export class AvailabilityModule {}
