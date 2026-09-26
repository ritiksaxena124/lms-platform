import { Module } from '@nestjs/common';

import { CourseRosterController } from './course-roster.controller';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsRepository } from './enrollments.repository';
import { EnrollmentsService } from './enrollments.service';

/**
 * The enrollment row and everything asked of it: a student taking a place, holding it, leaving
 * it, and the teacher who owns the course reading who is inside.
 *
 * `CourseModule` is a teacher writing their own work and `CatalogModule` is anybody reading
 * what is finished; neither of those questions is "may this person be inside this course",
 * which is a relationship between two accounts and lives in its own module for the same
 * reason ownership did — a service that answered all three would be a file of `if (role)`
 * branches around somebody else's rules. The roster controller sits here rather than in
 * `CourseModule` for the mirror of that reason: it reads this table, and a second module
 * reaching across for the rows would be two places where "who is enrolled" is defined.
 *
 * It reads nothing about lessons. What a place is worth is decided in §11's query, which
 * already has the two published gates and now gains the enrollment; duplicating that here
 * would be two places where the rules about readable pages are kept, and one of them would
 * eventually disagree.
 */
@Module({
  controllers: [EnrollmentsController, CourseRosterController],
  providers: [EnrollmentsService, EnrollmentsRepository],
})
export class EnrollmentsModule {}
