import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { WriteRecorder } from '../action-log/action-recorder';

const TOKEN_BYTES = 32;

const WITH_USER = {
  user: { include: { role: true, status: true } },
} as const satisfies Prisma.RefreshTokenInclude;

export type StoredSession = Prisma.RefreshTokenGetPayload<{ include: typeof WITH_USER }>;

/** The account a session turned out to belong to, read off the row the write moved.
 *
 * A record about signing out is about a person rather than about a token row (§7), so the answer it
 * has to give is whose session ended — which is what the retirement reports back with, and why the
 * caller does not have to trust the read it made a moment before. */
export type EndedSession = { userId: string };

/**
 * The only place a refresh token is a row. A session is worth keeping as data because it is
 * the one credential that must survive a restart and be revoked on demand — the access
 * token is deliberately neither.
 *
 * The two writes that end a session take an optional `record`, called inside their own transaction
 * for the reason §6 gives about the mail queue: a retirement that rolled back must not leave a record
 * of a sign-out nobody could see, and a record filed after the commit would be an account of the
 * change written twice — once by the statement and once by whatever it thought had happened.
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

  /**
   * Retirement, not deletion: the row stays so a replay of the old token is detectable.
   *
   * `revokedAt: null` is in the `where` rather than assumed from the read above it, which is what makes
   * a second sign-out of the same session change no row — and therefore file no record. The rotation
   * on `/auth/refresh` comes through here without a recorder: a token being replaced is what every
   * portal load does, and the row itself is the record of it.
   */
  async revoke(id: string, record?: WriteRecorder<EndedSession>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [ended] = await tx.refreshToken.updateManyAndReturn({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date(), isActive: false },
        select: { userId: true },
      });
      if (!ended) return;
      await record?.(tx, ended);
    });
  }

  /**
   * Ends every session an account has. Used when a retired token is replayed: at that point
   * the safe assumption is that the attacker has more than the one token we noticed.
   *
   * The count is handed to the recorder because it is the one fact about the finding that no row
   * keeps: each retired token says it stopped, and nothing says they stopped together, on the strength
   * of one being seen twice. Zero means there was nothing left to end, and a security event that
   * changed no row is the access log's business rather than this table's.
   */
  async revokeAllForUser(userId: string, record?: WriteRecorder<number>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), isActive: false },
      });
      if (count === 0) return;
      await record?.(tx, count);
    });
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
