import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CoursesController } from './course.controller';
import { CoursesRepository } from './courses.repository';
import { CoursesService } from './courses.service';

/**
 * Course authoring belongs to the teacher side of the platform; discovery — what a student
 * may read, and only once a course is published — arrives with the student portal and gets
 * its own surface rather than a flag on these routes.
 */
@Module({
  imports: [AuthModule],
  controllers: [CoursesController],
  providers: [CoursesService, CoursesRepository],
})
export class CourseModule {}
