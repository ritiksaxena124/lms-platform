import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CalendarRepository } from './calendar.repository';
import { ClassSeriesController, HolidayController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClassSeriesController, HolidayController],
  providers: [CalendarService, CalendarRepository],
})
export class CalendarModule {}
