import { Module } from '@nestjs/common';

import { ACCESS_TOKENS, JwtAccessTokens } from './access-tokens.service';
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
  ],
  exports: [AuthService],
})
export class AuthModule {}
