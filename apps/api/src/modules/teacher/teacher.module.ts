import { Module } from '@nestjs/common';

import { ActionLogModule } from '../action-log/action-log.module';
import { AuthModule } from '../auth/auth.module';
import { TeacherProfileController } from './teacher-profile.controller';
import { TeacherProfilesRepository } from './teacher-profiles.repository';
import { TeacherProfilesService } from './teacher-profiles.service';

/** Reference lookups are `@Global()`, so only the account side — and the recorder a save writes
 * its row through — has to be imported. */
@Module({
  imports: [ActionLogModule, AuthModule],
  controllers: [TeacherProfileController],
  providers: [TeacherProfilesService, TeacherProfilesRepository],
})
export class TeacherModule {}
