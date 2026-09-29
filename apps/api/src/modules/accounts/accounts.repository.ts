import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OpsAccountCounts } from '@lms/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { WriteRecorder } from '../action-log/action-recorder';

/** The two lookup rows, read for their code and their label and nothing else about them. */
const WITH_VOCABULARY = {
  role: { select: { code: true, label: true } },
  status: { select: { code: true, label: true } },
} as const satisfies Prisma.UserInclude;

export type AccountRow = Prisma.UserGetPayload<{ include: typeof WITH_VOCABULARY }>;

/** The filters the screen offers, already turned into values. */
export interface AccountFilter {
  search?: string;
  role?: string;
  status?: string;
}

/**
 * The account table, read the way an operator reads it.
 *
 * This is a second file over `users` after `UsersRepository`, and deliberately not a widening of it.
 * That repository is the auth path: it answers by address and by id for a sign-in, and it knows the
 * password hash. Nothing in it is optional or searchable, and an account screen that reached for it
 * would either carry a `passwordHash` further than it needs to travel or force the auth path to grow
 * a filter builder it has no business running. What they share is the table, and what each keeps is
 * the include graph its own callers may not live without.
 *
 * Both writes take an optional `record`, called inside the transaction that moved the row, for
 * §18's reason: a change that rolled back leaves no record behind, and a record of a change that
 * never happened is worse than no record.
 */
@Injectable()
export class AccountsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page, newest account first, with the total the same filters matched.
   *
   * The two statements go in one transaction array so the count is a answer about the same instant
   * as the page — a registration that lands between them would otherwise make a screen say "of 25
   * accounts, these 25" while a second page existed. */
  async page(
    filter: AccountFilter,
    skip: number,
    take: number,
  ): Promise<{ rows: AccountRow[]; total: number }> {
    const where = whereFor(filter);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: WITH_VOCABULARY,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(id: string): Promise<AccountRow | null> {
    return this.prisma.user.findUnique({ where: { id }, include: WITH_VOCABULARY });
  }

  /** What the account holds, as five counts and no rows.
   *
   * Each number is one relation, so none of them is a sum of two things an operator would read
   * differently: a teacher's booked classes and a student's booked classes are different problems,
   * and one number covering both would answer a question nobody asked.
   */
  async counts(id: string): Promise<OpsAccountCounts> {
    const [courses, enrollments, bookingsAsStudent, bookingsAsTeacher, activeSessions] =
      await this.prisma.$transaction([
        this.prisma.course.count({ where: { teacherUserId: id } }),
        this.prisma.enrollment.count({ where: { studentUserId: id } }),
        this.prisma.booking.count({ where: { studentUserId: id } }),
        this.prisma.booking.count({ where: { teacherUserId: id } }),
        this.prisma.refreshToken.count({
          where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
      ]);
    return { courses, enrollments, bookingsAsStudent, bookingsAsTeacher, activeSessions };
  }

  /** Move an account between the two statuses that decide whether it may sign in. One column, and
   * `isActive` stays out of it: disabled is a state an account comes back from, not an archive. */
  async updateStatusValue(
    id: string,
    statusValueId: string,
    record?: WriteRecorder<AccountRow>,
  ): Promise<AccountRow> {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.user.update({
        where: { id },
        data: { statusValueId },
        include: WITH_VOCABULARY,
      });
      await record?.(tx, account);
      return account;
    });
  }

  /** Move an account between portals, which is the same shape of write with a different column. */
  async updateRoleValue(
    id: string,
    roleValueId: string,
    record?: WriteRecorder<AccountRow>,
  ): Promise<AccountRow> {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.user.update({
        where: { id },
        data: { roleValueId },
        include: WITH_VOCABULARY,
      });
      await record?.(tx, account);
      return account;
    });
  }
}

function whereFor(filter: AccountFilter): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};

  // A substring over both columns, case-insensitively, because an operator arrives with whatever
  // case they copied. There is no index behind `contains`, and this is the one search in the API
  // that knows it: the table is accounts, not events, and it is the platform's own staff asking.
  if (filter.search) {
    where.OR = [
      { fullName: { contains: filter.search, mode: 'insensitive' } },
      { email: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  if (filter.role) where.role = { code: filter.role };
  if (filter.status) where.status = { code: filter.status };

  return where;
}
