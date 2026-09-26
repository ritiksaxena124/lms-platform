import { Module } from '@nestjs/common';

import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsRepository } from './enrollments.repository';
import { EnrollmentsService } from './enrollments.service';

/**
 * The student's side of a course: taking a place, holding it, leaving it.
 *
 * `CourseModule` is a teacher writing their own work and `CatalogModule` is anybody reading
 * what is finished; neither of those questions is "may this person be inside this course",
 * which is a relationship between two accounts and lives in its own module for the same
 * reason ownership did — a service that answered all three would be a file of `if (role)`
 * branches around somebody else's rules.
 *
 * It reads nothing about lessons. What a place is worth is decided in §11's query, which
 * already has the two published gates and now gains the enrollment; duplicating that here
 * would be two places where the rules about readable pages are kept, and one of them would
 * eventually disagree.
 */
@Module({
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService, EnrollmentsRepository],
})
export class EnrollmentsModule {}
