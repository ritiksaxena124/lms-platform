import { Module } from '@nestjs/common';

import { ActionLogModule } from '../action-log/action-log.module';
import { AuthModule } from '../auth/auth.module';
import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';

/**
 * The platform's own view of its accounts.
 *
 * `AuthModule` is here for the guards, and `ActionLogModule` for the recorder the two writes file
 * their rows with — the same pair of imports every module that writes a standing row now has, and
 * neither one of them gets to tell the recorder which part of the app it was writing in.
 *
 * This is a second module over `users` after auth, and the split is the point: auth answers "may this
 * person in", which is a question about a password and a session, and this answers "what is this
 * account, and what may an operator do to it". The two share a table and nothing else, and a route
 * that could reach a password hash from the accounts screen would be a worse platform than the one
 * where the reads live twice.
 */
@Module({
  imports: [AuthModule, ActionLogModule],
  controllers: [AccountsController],
  providers: [AccountsService, AccountsRepository],
})
export class AccountsModule {}
