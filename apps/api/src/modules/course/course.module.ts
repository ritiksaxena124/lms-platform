import { Module } from '@nestjs/common';

import { StorageModule } from '../../providers/storage/storage.module';
import { ActionLogModule } from '../action-log/action-log.module';
import { AuthModule } from '../auth/auth.module';
import { CourseModulesController } from './course-modules.controller';
import { CourseModulesRepository } from './course-modules.repository';
import { CourseModulesService } from './course-modules.service';
import { CoursesController } from './course.controller';
import { CoursesRepository } from './courses.repository';
import { CoursesService } from './courses.service';
import { LessonAssetsController } from './lesson-assets.controller';
import { LessonAssetsRepository } from './lesson-assets.repository';
import { LessonAssetsService } from './lesson-assets.service';
import { LessonsController } from './lessons.controller';
import { LessonsRepository } from './lessons.repository';
import { LessonsService } from './lessons.service';

/**
 * Course authoring belongs to the teacher side of the platform; discovery — what a student
 * may read, and only once a course is published — arrives with the student portal and gets
 * its own surface rather than a flag on these routes.
 *
 * A module is part of the course it sits in rather than its own domain: every route reaches
 * it through a course the session owns. A lesson shares this module for the same reason even
 * though it has a lifecycle of its own — the path to a lesson still runs through a course,
 * and ownership is answered once, in `CoursesRepository`, rather than three times. A recording
 * on a lesson shares it for the same reason a third time over, and borrows the same two
 * ownership reads rather than inventing a third answer to "is this page yours".
 */
@Module({
  imports: [AuthModule, StorageModule, ActionLogModule],
  controllers: [
    CoursesController,
    CourseModulesController,
    LessonsController,
    LessonAssetsController,
  ],
  providers: [
    CoursesService,
    CoursesRepository,
    CourseModulesService,
    CourseModulesRepository,
    LessonsService,
    LessonsRepository,
    LessonAssetsService,
    LessonAssetsRepository,
  ],
})
export class CourseModule {}
