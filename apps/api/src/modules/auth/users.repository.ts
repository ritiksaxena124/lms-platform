import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const WITH_CODES = { role: true, status: true } as const satisfies Prisma.UserInclude;

export type UserWithCodes = Prisma.UserGetPayload<{ include: typeof WITH_CODES }>;

/**
 * The only file that knows a user is a row. Keeping the include graph here means a
 * controller cannot accidentally read a user without its role and status, which is the
 * quiet way these endpoints start returning `role: undefined`.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.UserUncheckedCreateInput): Promise<UserWithCodes> {
    return this.prisma.user.create({ data, include: WITH_CODES });
  }

  async findByEmail(email: string): Promise<UserWithCodes | null> {
    return this.prisma.user.findUnique({ where: { email }, include: WITH_CODES });
  }

  async findById(id: string): Promise<UserWithCodes | null> {
    return this.prisma.user.findUnique({ where: { id }, include: WITH_CODES });
  }

  async recordLogin(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  /**
   * The zone belongs to the account, not to any one screen: it decides when a class is,
   * what "today" means in a dashboard and which reminders arrive at a sane hour. Writing it
   * here keeps one row holding it rather than a profile keeping a copy in step.
   */
  async updateTimezone(id: string, timezone: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { timezone } });
  }
}
