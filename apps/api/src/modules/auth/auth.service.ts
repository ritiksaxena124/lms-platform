import { ConflictException, Injectable, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACCOUNT_STATUS_CODES, API_ERROR_CODES, LKP_TYPE_CODES, type RoleCode } from '@lms/shared';

import { ReferenceService } from '../../reference/reference.service';
import type { RegisterDto } from './dto/register.dto';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher.service';
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

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly references: ReferenceService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
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
}
