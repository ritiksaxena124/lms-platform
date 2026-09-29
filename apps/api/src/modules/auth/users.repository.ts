import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { WriteRecorder } from '../action-log/action-recorder';

const WITH_CODES = { role: true, status: true } as const satisfies Prisma.UserInclude;

export type UserWithCodes = Prisma.UserGetPayload<{ include: typeof WITH_CODES }>;

/**
 * The only file that knows a user is a row. Keeping the include graph here means a
 * controller cannot accidentally read a user without its role and status, which is the
 * quiet way these endpoints start returning `role: undefined`.
 *
 * Both writes take an optional `record`, called inside the transaction that moved the row, and both
 * hand it the account as the write left it rather than as the caller described it. That is the outbox
 * rule (ARCHITECTURE §6) applied to the ledger: an account whose insert collided with a taken address
 * leaves no record behind, and a record of a sign-in names the role the row actually holds — which is
 * the one answer the account events in §7 are asked to give later.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.UserUncheckedCreateInput,
    record?: WriteRecorder<UserWithCodes>,
  ): Promise<UserWithCodes> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data, include: WITH_CODES });
      await record?.(tx, user);
      return user;
    });
  }

  async findByEmail(email: string): Promise<UserWithCodes | null> {
    return this.prisma.user.findUnique({ where: { email }, include: WITH_CODES });
  }

  async findById(id: string): Promise<UserWithCodes | null> {
    return this.prisma.user.findUnique({ where: { id }, include: WITH_CODES });
  }

  /** The one write that makes "when was this account last used" answerable — and the record of each
   * use is earned by it, twice over: signing in twice is two events, not one replayed. */
  async recordLogin(id: string, record?: WriteRecorder<UserWithCodes>): Promise<UserWithCodes> {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.user.update({
        where: { id },
        data: { lastLoginAt: new Date() },
        include: WITH_CODES,
      });
      await record?.(tx, account);
      return account;
    });
  }
}
