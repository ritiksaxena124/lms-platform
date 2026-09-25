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
    // Registering the guards here keeps `UsersRepository` private to this module while
    // making them global: `APP_GUARD` applies to every route in the application, so a
    // feature module added later is authenticated before anyone remembers to ask.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
