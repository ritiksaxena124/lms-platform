import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/** The course a slot is offered for, and the two facts about it that decide who may look. */
const BOOKABLE_COURSE_SELECT = {
  id: true,
  slug: true,
  title: true,
  teacherUserId: true,
  demoBookingsEnabled: true,
  teacher: { select: { id: true, timezone: true } },
} as const satisfies Prisma.CourseSelect;

export type BookableCourseRow = Prisma.CourseGetPayload<{ select: typeof BOOKABLE_COURSE_SELECT }>;

/**
 * The table behind a booked class, and the course a booking is made against.
 *
 * Two things are read here that the table itself refuses to decide, and both are named as
 * questions rather than hidden in a query: which statuses occupy a minute (the unique index on
 * the slot hold keeps *a* row per minute and knows nothing about vocabulary — `BLOCKING_BOOKING_*`
 * statuses are the policy, resolved to lookup ids by the service), and whether a student has
 * already taken their one demo (a count over surviving rows, including the cancelled ones,
 * because the cap is about a person having tried a teacher once).
 *
 * Ownership is in every `where` clause rather than checked afterwards, the rule every repository
 * here runs on.
 */
@Injectable()
export class BookingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A course a student may book in: published and live, addressed by id or by slug.
   *
   * Both spellings reach one row, which is the property the catalog already keeps its routes to —
   * a student arrives at a booking screen from a link, and a link may carry either.
   */
  async findBookableCourse(
    ref: { id: string } | { slug: string },
    courseStatusValueId: string,
  ): Promise<BookableCourseRow | null> {
    return this.prisma.course.findFirst({
      where: { ...ref, isActive: true, statusValueId: courseStatusValueId },
      select: BOOKABLE_COURSE_SELECT,
    });
  }

  /** The minutes this teacher cannot offer, because a standing booking holds them. */
  async heldStarts(
    teacherUserId: string,
    blockingStatusValueIds: string[],
    from: Date,
    to: Date,
  ): Promise<Date[]> {
    if (blockingStatusValueIds.length === 0) return [];
    const rows = await this.prisma.booking.findMany({
      where: {
        teacherUserId,
        isActive: true,
        statusValueId: { in: blockingStatusValueIds },
        startsAt: { gte: from, lt: to },
      },
      select: { startsAt: true },
    });
    return rows.map((row) => row.startsAt);
  }

  /** Whether this student has ever taken a demo in this course — any demo, in any state. */
  async hasDemoBooking(
    courseId: string,
    studentUserId: string,
    demoTypeValueId: string,
  ): Promise<boolean> {
    const count = await this.prisma.booking.count({
      where: { courseId, studentUserId, typeValueId: demoTypeValueId, isActive: true },
    });
    return count > 0;
  }
}
