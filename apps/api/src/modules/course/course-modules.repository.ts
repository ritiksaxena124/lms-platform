import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { planSlotMoves, type Slot } from './slot-moves';

/** What a lesson route needs from a module: that it exists, that the caller's course holds
 * it, and what that course's life is. The lesson's own status is not here, because at this
 * point the question is reachability rather than what may be read. */
const WITH_COURSE = {
  course: { select: { id: true, status: { select: { code: true } } } },
} as const satisfies Prisma.ModuleInclude;

export type ModuleWithCourse = Prisma.ModuleGetPayload<{ include: typeof WITH_COURSE }>;

/** Columns a writer may set. `position` is absent because the service assigns it, and a
 * repository that accepted one would be the hole the unique index exists to catch. */
export interface CourseModuleColumns {
  title: string;
  summary: string | null;
  description: string | null;
}

/**
 * Reads and writes scoped by `courseId` in the `where` clause rather than checked after the
 * fact, so a module id alone is never a key: it has to sit inside the course the route
 * named. `isActive` is part of every read, which is what makes deactivating a module the
 * same answer as it never existing.
 */
@Injectable()
export class CourseModulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every module the course shows, in the order a student would read them. */
  async listActive(courseId: string) {
    return this.prisma.module.findMany({
      where: { courseId, isActive: true },
      orderBy: { position: 'asc' },
    });
  }

  async findInCourse(courseId: string, id: string) {
    return this.prisma.module.findFirst({ where: { id, courseId, isActive: true } });
  }

  /**
   * The module a lesson route names, resolved against the caller's own courses in one read.
   *
   * A lesson hangs off a module and a module off a course, so ownership is two hops — and
   * both have to be answered by the query that found the module, because a check afterwards
   * is a window in which a lesson could be filed under a course the caller cannot see.
   */
  async findOwned(teacherUserId: string, id: string): Promise<ModuleWithCourse | null> {
    return this.prisma.module.findFirst({
      where: { id, isActive: true, course: { teacherUserId, isActive: true } },
      include: WITH_COURSE,
    });
  }

  /**
   * The end of the order. Retired rows are counted: a slot a module vacated is not offered
   * to a new one, so a link or a screenshot naming "module 3" cannot come to mean two
   * different things over time.
   */
  async lastPosition(courseId: string): Promise<number> {
    const { _max } = await this.prisma.module.aggregate({
      where: { courseId },
      _max: { position: true },
    });
    return _max.position ?? 0;
  }

  /** The slots the active modules hold, lowest first. */
  async activeSlots(courseId: string): Promise<Slot[]> {
    const rows = await this.prisma.module.findMany({
      where: { courseId, isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    return rows.map(({ id, position }) => ({ id, position }));
  }

  /**
   * Whether the block holds anything a student could open — an active page whose own gate is
   * open. `deactivate` asks this before it refuses, so the rule is "you may not take away what
   * is being read" rather than "you may not take away anything at all while the course is
   * live", which would trap a block the catalog does not even show.
   */
  async hasPagesToRead(moduleId: string, publishedLessonStatusValueId: string) {
    const page = await this.prisma.lesson.findFirst({
      where: { moduleId, isActive: true, statusValueId: publishedLessonStatusValueId },
      select: { id: true },
    });
    return page !== null;
  }

  async create(courseId: string, position: number, columns: CourseModuleColumns) {
    return this.prisma.module.create({ data: { courseId, position, ...columns } });
  }

  async updateColumns(id: string, columns: Partial<CourseModuleColumns>) {
    return this.prisma.module.update({ where: { id }, data: columns });
  }

  async deactivate(id: string) {
    return this.prisma.module.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * Writes the new order in one transaction.
   *
   * `uk_module_course_position` is checked as each row is written, not when the transaction
   * commits, so a straight swap of two modules would fail on its second row: the first has
   * already taken the slot the second still stands in. Every row is lifted above the highest
   * slot a course can reach before any of them is set down, which is the one ordering that
   * cannot collide with itself.
   */
  async placeInSlots(slots: Slot[], orderedIds: string[]) {
    const moves = planSlotMoves(slots, orderedIds, 'module');

    await this.prisma.$transaction(async (tx) => {
      for (const move of moves) {
        await tx.module.update({ where: { id: move.id }, data: { position: move.lift } });
      }
      for (const move of moves) {
        await tx.module.update({ where: { id: move.id }, data: { position: move.into } });
      }
    });
  }
}
