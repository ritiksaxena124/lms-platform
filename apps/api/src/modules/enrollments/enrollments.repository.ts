import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/** The course a place is in, enough of it to name the thing and link to it. */
const WITH_COURSE = {
  course: { select: { id: true, slug: true, title: true } },
} as const satisfies Prisma.EnrollmentInclude;

export type EnrollmentRow = Prisma.EnrollmentGetPayload<{ include: typeof WITH_COURSE }>;

/**
 * The table behind the student's place in a course.
 *
 * Every read and write is scoped by `studentUserId` in the `where` clause rather than checked
 * afterwards — the same rule the teacher's repositories run on, arriving on the other side of
 * the relationship. A place in somebody else's name and a place that was never taken answer
 * the same way, so no call can probe which enrollments exist.
 */
@Injectable()
export class EnrollmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The pair, active or not. A student who left is found here rather than treated as
   * nobody, because the row they left behind is the one that gets reopened. */
  async findPlace(studentUserId: string, courseId: string) {
    return this.prisma.enrollment.findUnique({
      where: { courseId_studentUserId: { courseId, studentUserId } },
      include: WITH_COURSE,
    });
  }

  async openPlace(studentUserId: string, courseId: string) {
    return this.prisma.enrollment.create({
      data: { studentUserId, courseId },
      include: WITH_COURSE,
    });
  }

  /** Reopening the row rather than writing a second one: one place per student per course,
   * and the day it was first taken stays in `createdAt`. */
  async reactivate(id: string) {
    return this.prisma.enrollment.update({
      where: { id },
      data: { isActive: true },
      include: WITH_COURSE,
    });
  }

  async close(id: string) {
    return this.prisma.enrollment.update({
      where: { id },
      data: { isActive: false },
      include: WITH_COURSE,
    });
  }

  /** The caller's place by its own id, and only their own. */
  async findOwnPlace(studentUserId: string, id: string) {
    return this.prisma.enrollment.findFirst({
      where: { id, studentUserId },
      include: WITH_COURSE,
    });
  }

  /**
   * What the student is inside of, newest first.
   *
   * Only places that are open, and only in a course that is still on the shelf: a list the
   * portal can render as links has to be a list of things that will open. The enrollment row
   * of a retired course is untouched by this filter — it stays for the record the pages the
   * student already read were opened by.
   */
  async listOpen(studentUserId: string, courseStatusValueId: string) {
    return this.prisma.enrollment.findMany({
      where: {
        studentUserId,
        isActive: true,
        course: { isActive: true, statusValueId: courseStatusValueId },
      },
      include: WITH_COURSE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** A course a place can be taken in: published and live, by id and nothing else. A slug
   * is a nicer thing to read in a link than to write in a body, and the catalog already
   * answers both spellings; this route is given the id the catalog sent. */
  async findEnrollableCourse(courseId: string, courseStatusValueId: string) {
    return this.prisma.course.findFirst({
      where: { id: courseId, isActive: true, statusValueId: courseStatusValueId },
      select: { id: true },
    });
  }
}
