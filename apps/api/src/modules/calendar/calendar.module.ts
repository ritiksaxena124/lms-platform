import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { CalendarRepository } from './calendar.repository';
import { ClassSeriesController, HolidayController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { ClassOccurrenceController } from './class-occurrence.controller';
import { ClassOccurrenceRepository } from './class-occurrence.repository';
import { ClassOccurrenceService } from './class-occurrence.service';

/**
 * The teacher's recurring calendar and the dated classes it stands for.
 *
 * Two tables' worth of questions live here rather than in `BookingsModule` because the two answers
 * are owned by different people: a booking is a student's request for one minute, while a series is
 * a teacher's plan for a whole week and the classes it opens exist whether or not anybody asks for
 * them. They share the window arithmetic in §5 and nothing else.
 *
 * `EnrollmentsModule` is imported for one question — which names hold a place in a course — and the
 * row it asks about is not ours to read directly. The sweep writes a register of names beside every
 * class it opens, and who is on that sheet is exactly who holds a place, which makes the answer
 * somebody else's table and this module a caller.
 */
@Module({
  imports: [PrismaModule, EnrollmentsModule],
  controllers: [ClassSeriesController, HolidayController, ClassOccurrenceController],
  providers: [
    CalendarService,
    CalendarRepository,
    ClassOccurrenceService,
    ClassOccurrenceRepository,
  ],
})
export class CalendarModule {}
