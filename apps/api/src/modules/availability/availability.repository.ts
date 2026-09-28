import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { WriteRecorder } from '../action-log/action-recorder';

/** The four numbers that make a window, in the units the table holds them. */
export interface RuleWindow {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
}

/** The whole row: every read here is of a window, so no `select` narrows it. */
export type AvailabilityRow = Prisma.AvailabilityRuleGetPayload<object>;

/**
 * The table behind a teacher's week.
 *
 * Every read and write carries `teacherUserId` in its `where` clause rather than checking
 * ownership afterwards — the rule every other repository here runs on. Another teacher's window
 * and a uuid nobody wrote are the same non-row, so no call can probe whose schedule exists.
 */
@Injectable()
export class AvailabilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** A week read in the order a teacher looks at it: by day, then by the minute each window
   * opens. Retired rows are not here — a teacher is not teaching from a window they closed, and
   * the row lives on for the bookings already made inside it. */
  async listActive(teacherUserId: string): Promise<AvailabilityRow[]> {
    return this.prisma.availabilityRule.findMany({
      where: { teacherUserId, isActive: true },
      orderBy: [{ weekday: 'asc' }, { startMinutes: 'asc' }],
    });
  }

  /** Retirement is not deletion, so a retired window is still the caller's to be told about:
   * the service answers a second retirement as a state problem rather than a missing row. */
  async findOwned(teacherUserId: string, id: string): Promise<AvailabilityRow | null> {
    return this.prisma.availabilityRule.findFirst({ where: { id, teacherUserId } });
  }

  /**
   * A standing window that covers any of these minutes on this day.
   *
   * Half-open, which is what makes 09:00–10:00 and 10:00–11:00 two classes rather than a
   * collision: the ranges overlap when one opens before the other closes *and* closes after the
   * other opens, and touching is not overlapping.
   */
  async findOverlap(
    teacherUserId: string,
    window: RuleWindow,
    exceptId?: string,
  ): Promise<AvailabilityRow | null> {
    return this.prisma.availabilityRule.findFirst({
      where: {
        teacherUserId,
        isActive: true,
        weekday: window.weekday,
        startMinutes: { lt: window.endMinutes },
        endMinutes: { gt: window.startMinutes },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
  }

  /** The retired row sitting on this opening minute, if there is one. The business key is unique
   * among retired rows as well as live ones, so a window re-opened at a minute that has been
   * used before is that row reopened, not a new one (§2). */
  async findRetiredAt(
    teacherUserId: string,
    weekday: number,
    startMinutes: number,
  ): Promise<AvailabilityRow | null> {
    const row = await this.prisma.availabilityRule.findUnique({
      where: { teacherUserId_weekday_startMinutes: { teacherUserId, weekday, startMinutes } },
    });
    return row && !row.isActive ? row : null;
  }

  async open(
    teacherUserId: string,
    window: RuleWindow,
    record?: WriteRecorder<AvailabilityRow>,
  ): Promise<AvailabilityRow> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.availabilityRule.create({ data: { teacherUserId, ...window } });
      await record?.(tx, rule);
      return rule;
    });
  }

  async rewrite(
    id: string,
    window: RuleWindow,
    record?: WriteRecorder<AvailabilityRow>,
  ): Promise<AvailabilityRow> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.availabilityRule.update({ where: { id }, data: window });
      await record?.(tx, rule);
      return rule;
    });
  }

  /** The same call as `rewrite` plus the flag: a teacher setting a window at a minute they used
   * before is bringing that window back, and the row keeps the day it was first written. */
  async reopen(
    id: string,
    window: RuleWindow,
    record?: WriteRecorder<AvailabilityRow>,
  ): Promise<AvailabilityRow> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.availabilityRule.update({
        where: { id },
        data: { ...window, isActive: true },
      });
      await record?.(tx, rule);
      return rule;
    });
  }

  async retire(id: string, record?: WriteRecorder<AvailabilityRow>): Promise<AvailabilityRow> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.availabilityRule.update({
        where: { id },
        data: { isActive: false },
      });
      await record?.(tx, rule);
      return rule;
    });
  }
}
