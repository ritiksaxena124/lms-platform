import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const TOKEN_BYTES = 32;

const WITH_USER = {
  user: { include: { role: true, status: true } },
} as const satisfies Prisma.RefreshTokenInclude;

export type StoredSession = Prisma.RefreshTokenGetPayload<{ include: typeof WITH_USER }>;

/**
 * The only place a refresh token is a row. A session is worth keeping as data because it is
 * the one credential that must survive a restart and be revoked on demand — the access
 * token is deliberately neither.
 */
@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues a session and returns the secret alongside it. Only the hash is stored: a copy
   * of the table lets an attacker refresh someone else's session, which is the thing the
   * database is least able to prevent afterwards.
   */
  async issue(
    userId: string,
    ttlDays: number,
    userAgent?: string,
  ): Promise<{ token: string; id: string }> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const row = await this.prisma.refreshToken.create({
      data: {
        tokenHash: hash(token),
        userId,
        userAgent: userAgent?.slice(0, 300),
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      },
      select: { id: true },
    });
    return { token, id: row.id };
  }

  async find(token: string): Promise<StoredSession | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(token) },
      include: WITH_USER,
    });
  }

  /** Retirement, not deletion: the row stays so a replay of the old token is detectable. */
  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date(), isActive: false },
    });
  }

  /**
   * Ends every session an account has. Used when a retired token is replayed: at that point
   * the safe assumption is that the attacker has more than the one token we noticed.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), isActive: false },
    });
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
