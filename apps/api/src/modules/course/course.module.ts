import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CourseModulesController } from './course-modules.controller';
import { CourseModulesRepository } from './course-modules.repository';
import { CourseModulesService } from './course-modules.service';
import { CoursesController } from './course.controller';
import { CoursesRepository } from './courses.repository';
import { CoursesService } from './courses.service';

/**
 * Course authoring belongs to the teacher side of the platform; discovery — what a student
 * may read, and only once a course is published — arrives with the student portal and gets
 * its own surface rather than a flag on these routes.
 *
 * A module is part of the course it sits in rather than its own domain: it has no lifecycle
 * of its own, and every route reaches it through a course the session owns, so it shares
 * this module's controllers and repositories.
 */
@Module({
  imports: [AuthModule],
  controllers: [CoursesController, CourseModulesController],
  providers: [CoursesService, CoursesRepository, CourseModulesService, CourseModulesRepository],
})
export class CourseModule {}
