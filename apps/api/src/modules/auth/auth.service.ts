import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACCOUNT_STATUS_CODES, API_ERROR_CODES, LKP_TYPE_CODES, type RoleCode } from '@lms/shared';

import { ENV } from '../../config/env.module';
import type { AppEnv } from '../../config/env';
import { ReferenceService } from '../../reference/reference.service';
import { ACCESS_TOKENS, type AccessTokenPort } from './access-tokens.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher.service';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import type { UserWithCodes } from './users.repository';
import { UsersRepository } from './users.repository';

/** What a portal is allowed to know about an account. `passwordHash` is not on it. */
export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: RoleCode;
  status: string;
  timezone: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

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

@Injectable()
export class AuthService {
  /** Cached so the first wrong address and the first wrong password cost the same. */
  private dummyDigest?: Promise<string>;

  constructor(
    private readonly users: UsersRepository,
    private readonly references: ReferenceService,
    private readonly sessions: RefreshTokensRepository,
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
      const user = await this.users.create({
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        timezone: dto.timezone ?? 'UTC',
        roleValueId,
        statusValueId,
      });
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
    await this.users.recordLogin(user.id);
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
      await this.sessions.revokeAllForUser(session.userId);
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

  /** Idempotent by design: signing out of an unknown session is still signed out. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const session = await this.sessions.find(rawToken);
    if (session) await this.sessions.revoke(session.id);
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
