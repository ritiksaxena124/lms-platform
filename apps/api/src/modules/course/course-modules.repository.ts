import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

/** Higher than any slot a course reaches by appending one module at a time, and the reason
 * a lift can never land on a row this transaction is not touching. */
const SLOT_CLEARANCE = 100_000;

/** Columns a writer may set. `position` is absent because the service assigns it, and a
 * repository that accepted one would be the hole the unique index exists to catch. */
export interface CourseModuleColumns {
  title: string;
  summary: string | null;
  description: string | null;
}

/** A module id and the slot it currently holds — the whole of what a reorder needs. */
export interface ModuleSlot {
  id: string;
  position: number;
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
  async activeSlots(courseId: string): Promise<ModuleSlot[]> {
    const rows = await this.prisma.module.findMany({
      where: { courseId, isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    return rows.map(({ id, position }) => ({ id, position }));
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
  async placeInSlots(slots: ModuleSlot[], orderedIds: string[]) {
    // The service has already proved the two lists describe the same modules, so pairing them
    // here is the whole of the arithmetic: the nth module of the new order takes the nth slot
    // the syllabus held.
    const moves = slots.map((slot, index) => {
      const id = orderedIds[index];
      if (!id) throw new Error(`No module to place in slot ${slot.position}`);
      return { id, into: slot.position, lift: slot.position + SLOT_CLEARANCE };
    });
    if (moves.length !== orderedIds.length) {
      throw new Error('Reorder named more modules than the course has slots');
    }

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
