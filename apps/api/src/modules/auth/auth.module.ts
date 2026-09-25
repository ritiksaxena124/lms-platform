import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ACCESS_TOKENS, JwtAccessTokens } from './access-tokens.service';
import { JwtAuthGuard, RolesGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PASSWORD_HASHER, ScryptPasswordHasher } from './password-hasher.service';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { UsersRepository } from './users.repository';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersRepository,
    RefreshTokensRepository,
    { provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher },
    { provide: ACCESS_TOKENS, useClass: JwtAccessTokens },
    // The guards are registered here rather than in the root module so that everything an
    // authenticated request needs — token check, account row, role — is defined next to
    // the code that owns them. `APP_GUARD` still applies to every route in the
    // application, so a feature module added later is protected before anyone asks.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // `UsersRepository` is exported, not duplicated: a teacher profile writes the working
  // timezone onto the account, and this stays the only module that reads the user row.
  exports: [AuthService, UsersRepository],
})
export class AuthModule {}
