import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { WriteRecorder } from '../action-log/action-recorder';
import { planSlotMoves, type Slot, type SlotMove } from './slot-moves';

/** The status travels with every lesson the API returns, code and label together — the same
 * promise a course makes about its own vocabulary. */
const WITH_STATUS = {
  status: { select: { code: true, label: true } },
} as const satisfies Prisma.LessonInclude;

export type LessonWithStatus = Prisma.LessonGetPayload<{ include: typeof WITH_STATUS }>;

/** Columns a writer may set. Neither `position` nor `statusValueId` belongs here: the first
 * is assigned by the service and the second moves only through a transition. */
export interface LessonColumns {
  title: string;
  body: string | null;
  estimatedMinutes: number | null;
  /** Optional because a create has no such box — the page starts locked, and opening it is a
   * decision the edit form makes. It belongs to the writable columns because that form writes it. */
  isFreePreview?: boolean;
}

/**
 * Reads and writes scoped by `moduleId` in the `where` clause rather than checked after the
 * fact, so a lesson id alone is never a key: it has to sit inside the module the route named.
 * `isActive` is part of every read, which is what makes deactivating a lesson the same answer
 * as it never existing.
 *
 * Every write takes the `record` callback the course and module repositories take, and each one now
 * owns a transaction so that the page and the record of the decision to write it commit together.
 * `moveTo` is the one that needs saying: a page changing block touches two of a lesson's columns at
 * once, and it is still one decision, so it still files one row.
 */
@Injectable()
export class LessonsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every lesson the module shows, in the order a student would read them — both statuses,
   * because this is the author's list and a draft is something they are still writing. */
  async listActive(moduleId: string) {
    return this.prisma.lesson.findMany({
      where: { moduleId, isActive: true },
      orderBy: { position: 'asc' },
      include: WITH_STATUS,
    });
  }

  async findInModule(moduleId: string, id: string) {
    return this.prisma.lesson.findFirst({
      where: { id, moduleId, isActive: true },
      include: WITH_STATUS,
    });
  }

  /**
   * The end of the order. Retired rows are counted, and so is a lesson that has moved away
   * and come back: a slot a lesson vacated is not offered to a new one, so a link or a note
   * naming "lesson 3" cannot come to mean a different page.
   */
  async lastPosition(moduleId: string): Promise<number> {
    const { _max } = await this.prisma.lesson.aggregate({
      where: { moduleId },
      _max: { position: true },
    });
    return _max.position ?? 0;
  }

  /** The slots the active lessons hold, lowest first. */
  async activeSlots(moduleId: string): Promise<Slot[]> {
    const rows = await this.prisma.lesson.findMany({
      where: { moduleId, isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    return rows.map(({ id, position }) => ({ id, position }));
  }

  async create(
    moduleId: string,
    position: number,
    statusValueId: string,
    columns: LessonColumns,
    record?: WriteRecorder<LessonWithStatus>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lesson = await tx.lesson.create({
        data: { moduleId, position, statusValueId, ...columns },
        include: WITH_STATUS,
      });
      await record?.(tx, lesson);
      return lesson;
    });
  }

  async updateColumns(
    id: string,
    columns: Partial<LessonColumns>,
    record?: WriteRecorder<LessonWithStatus>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lesson = await tx.lesson.update({
        where: { id },
        data: columns,
        include: WITH_STATUS,
      });
      await record?.(tx, lesson);
      return lesson;
    });
  }

  async updateStatus(id: string, statusValueId: string, record?: WriteRecorder<LessonWithStatus>) {
    return this.prisma.$transaction(async (tx) => {
      const lesson = await tx.lesson.update({
        where: { id },
        data: { statusValueId },
        include: WITH_STATUS,
      });
      await record?.(tx, lesson);
      return lesson;
    });
  }

  /**
   * A move between modules, written as one update.
   *
   * The row leaves the block it was in, so the number it held is not reserved the way a
   * retired lesson's is — nothing in that module points at it any more. The next page written
   * there starts from the highest slot the module still contains.
   */
  async moveTo(
    id: string,
    moduleId: string,
    position: number,
    record?: WriteRecorder<LessonWithStatus>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lesson = await tx.lesson.update({
        where: { id },
        data: { moduleId, position },
        include: WITH_STATUS,
      });
      await record?.(tx, lesson);
      return lesson;
    });
  }

  async deactivate(id: string, record?: WriteRecorder<LessonWithStatus>) {
    return this.prisma.$transaction(async (tx) => {
      const lesson = await tx.lesson.update({
        where: { id },
        data: { isActive: false },
        include: WITH_STATUS,
      });
      await record?.(tx, lesson);
      return lesson;
    });
  }

  /**
   * Writes the new order in one transaction.
   *
   * `uk_lesson_module_position` is checked as each row is written, not when the transaction
   * commits, so a straight swap of two lessons would fail on its second row: the first has
   * already taken the slot the second still stands in. Every row is lifted above the highest
   * slot a module can reach before any of them is set down, which is the one ordering that
   * cannot collide with itself.
   */
  async placeInSlots(slots: Slot[], orderedIds: string[], record?: WriteRecorder<SlotMove[]>) {
    const moves = planSlotMoves(slots, orderedIds, 'lesson');

    await this.prisma.$transaction(async (tx) => {
      for (const move of moves) {
        await tx.lesson.update({ where: { id: move.id }, data: { position: move.lift } });
      }
      for (const move of moves) {
        await tx.lesson.update({ where: { id: move.id }, data: { position: move.into } });
      }
      // After the last position lands: a reorder that died halfway keeps no record of an order
      // the module never held.
      await record?.(tx, moves);
    });
  }
}
