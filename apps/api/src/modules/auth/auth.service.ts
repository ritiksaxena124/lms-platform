import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACCOUNT_STATUS_CODES,
  ACTION_CODES,
  API_ERROR_CODES,
  LKP_TYPE_CODES,
  type AuthUser,
  type RoleCode,
} from '@lms/shared';

import { ENV } from '../../config/env.module';
import type { AppEnv } from '../../config/env';
import { ReferenceService } from '../../reference/reference.service';
import { ActionRecorder } from '../action-log/action-recorder';
import { ACCESS_TOKENS, type AccessTokenPort } from './access-tokens.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher.service';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import type { UserWithCodes } from './users.repository';
import { UsersRepository } from './users.repository';

/** What a portal is allowed to know about an account. `passwordHash` is not on it. */
export type PublicUser = AuthUser;

export function toPublicUser(user: UserWithCodes): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role.code as RoleCode,
    status: user.status.code,
    timezone: user.timezone,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** The response both `/login` and `/refresh` produce: who you are, and two tokens. */
export interface Session {
  user: PublicUser;
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
}

/**
 * The account, and the four things that happen to it which the log is asked about later.
 *
 * These are the only writes in the API that name their own actor, and the reason is in the routes:
 * every `/auth/*` handler is `@Public()`, so `JwtAuthGuard` resolves nobody and the request context
 * holds no account to read. On `/register` the account does not exist until the write below makes it,
 * and on `/login` nobody has signed in yet — so `recordAs` takes the actor from the row the statement
 * just moved, and the recorder allows that only for the `account` section (ARCHITECTURE §7).
 *
 * What is not filed here is as deliberate as what is: a refused sign-in, a disabled account and a
 * rotation all answer a person and change nothing about them, and a token being replaced on a portal
 * load would put a row in the ledger for every page view. The events are the account's — never a
 * `refresh_token` row's — which is why each one names the same id twice, as the row it happened to and
 * as the person who made it happen.
 */
@Injectable()
export class AuthService {
  /** Cached so the first wrong address and the first wrong password cost the same. */
  private dummyDigest?: Promise<string>;

  constructor(
    private readonly users: UsersRepository,
    private readonly references: ReferenceService,
    private readonly sessions: RefreshTokensRepository,
    private readonly actions: ActionRecorder,
    @Inject(ACCESS_TOKENS) private readonly tokens: AccessTokenPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    const [roleValueId, statusValueId, passwordHash] = await Promise.all([
      this.references.valueId(LKP_TYPE_CODES.USER_ROLE, dto.role),
      this.references.valueId(LKP_TYPE_CODES.ACCOUNT_STATUS, ACCOUNT_STATUS_CODES.ACTIVE),
      this.hasher.hash(dto.password),
    ]);

    try {
      const user = await this.users.create(
        {
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          timezone: dto.timezone ?? 'UTC',
          roleValueId,
          statusValueId,
        },
        // Nothing is named in `detail`: the role, the status, the address and the day are columns of
        // the row this insert wrote, and the digest is not a fact a ledger should be able to read.
        (tx, account) =>
          this.actions.recordAs(
            { userId: account.id, userRole: account.role.code as RoleCode },
            tx,
            { action: ACTION_CODES.ACCOUNT_REGISTERED, targetId: account.id },
          ),
      );
      return toPublicUser(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: API_ERROR_CODES.EMAIL_ALREADY_TAKEN,
          message: 'That email address already has an account.',
          details: { validation: { email: ['Already registered.'] } },
        });
      }
      throw error;
    }
  }

  async login(dto: LoginDto, userAgent?: string): Promise<Session> {
    const user = await this.users.findByEmail(dto.email);
    const passwordMatches = await this.checkPassword(user, dto.password);

    // One message for both failures, and the same amount of work: a login form that answers
    // "no such account" instantly and "wrong password" after 300ms lists its users.
    if (!user || !passwordMatches) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.INVALID_CREDENTIALS,
        message: 'Email or password is incorrect.',
      });
    }

    this.assertActive(user);
    // The record rides on the write that moved `lastLoginAt`, so a sign-in that failed the password
    // or the status gate above leaves nothing behind, and two sign-ins are two rows.
    await this.users.recordLogin(user.id, (tx, account) =>
      this.actions.recordAs({ userId: account.id, userRole: account.role.code as RoleCode }, tx, {
        action: ACTION_CODES.SIGNED_IN,
        targetId: account.id,
      }),
    );
    return this.startSession(user, userAgent);
  }

  /**
   * Rotates the presented token. The old one is retired whether or not the new one is ever
   * used, so a copied token either dies with the original or announces the copy.
   */
  async refresh(rawToken: string | undefined, userAgent?: string): Promise<Session> {
    if (!rawToken) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.TOKEN_INVALID,
        message: 'No active session.',
      });
    }

    const session = await this.sessions.find(rawToken);
    if (!session) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.TOKEN_INVALID,
        message: 'Session is not recognised.',
      });
    }

    if (session.revokedAt) {
      // A retired token is being replayed. Something has a copy of it, and we cannot know
      // what else it has, so every session that account holds ends here.
      //
      // The finding is recorded before the answer is given, and by the write rather than by the
      // exception: the person who reads this row later is the one whose sessions were ended, and the
      // number says how many the copy cost them. Nothing left to end is nothing done, so the
      // repository files only the sweeps that moved a row.
      await this.sessions.revokeAllForUser(session.userId, (tx, revoked) =>
        this.actions.recordAs(
          { userId: session.userId, userRole: session.user.role.code as RoleCode },
          tx,
          {
            action: ACTION_CODES.SESSION_REPLAY_DETECTED,
            targetId: session.userId,
            detail: { revokedSessions: revoked },
          },
        ),
      );
      throw new UnauthorizedException({
        code: API_ERROR_CODES.TOKEN_INVALID,
        message: 'Session has already been used.',
      });
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessions.revoke(session.id);
      throw new UnauthorizedException({
        code: API_ERROR_CODES.TOKEN_EXPIRED,
        message: 'Session has expired. Please sign in again.',
      });
    }

    this.assertActive(session.user);
    await this.sessions.revoke(session.id);
    return this.startSession(session.user, userAgent);
  }

  /**
   * Idempotent by design: signing out of an unknown session is still signed out.
   *
   * The same clause makes it file once. A second press of the button retires nothing — the row was
   * already retired — so the record is filed by the write that ended a live session and by no other,
   * which is why this answers 204 twice and the ledger says `signed_out` once.
   */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const session = await this.sessions.find(rawToken);
    if (!session) return;

    await this.sessions.revoke(session.id, (tx, ended) =>
      this.actions.recordAs(
        { userId: ended.userId, userRole: session.user.role.code as RoleCode },
        tx,
        { action: ACTION_CODES.SIGNED_OUT, targetId: ended.userId },
      ),
    );
  }

  /**
   * The account behind a verified token, read now rather than remembered from the token.
   * The guard has already proved the caller holds a valid token for this id and that the
   * account is active; this turns that back into what the portal renders.
   */
  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.TOKEN_INVALID,
        message: 'Session is not recognised.',
      });
    }
    return toPublicUser(user);
  }

  private async startSession(user: UserWithCodes, userAgent?: string): Promise<Session> {
    const issued = this.tokens.issue({ sub: user.id, role: user.role.code });
    const { token } = await this.sessions.issue(
      user.id,
      this.env.REFRESH_TOKEN_TTL_DAYS,
      userAgent,
    );
    return {
      user: toPublicUser(user),
      accessToken: issued.token,
      expiresInSeconds: issued.expiresInSeconds,
      refreshToken: token,
    };
  }

  private async checkPassword(user: UserWithCodes | null, password: string): Promise<boolean> {
    if (user) return this.hasher.verify(user.passwordHash, password);
    await this.hasher.verify(await this.dummy(), password);
    return false;
  }

  private dummy(): Promise<string> {
    this.dummyDigest ??= this.hasher.hash('timing-equaliser-not-a-password');
    return this.dummyDigest;
  }

  private assertActive(user: UserWithCodes): void {
    if (user.status.code !== ACCOUNT_STATUS_CODES.ACTIVE) {
      throw new ForbiddenException({
        code: API_ERROR_CODES.ACCOUNT_DISABLED,
        message: 'This account is disabled. Contact support.',
      });
    }
  }
}
