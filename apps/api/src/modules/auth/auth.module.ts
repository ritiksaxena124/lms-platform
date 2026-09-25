import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PASSWORD_HASHER, ScryptPasswordHasher } from './password-hasher.service';
import { UsersRepository } from './users.repository';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersRepository,
    { provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher },
  ],
  exports: [AuthService],
})
export class AuthModule {}
