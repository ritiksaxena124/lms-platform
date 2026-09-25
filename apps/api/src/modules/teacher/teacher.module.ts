import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { TeacherProfileController } from './teacher-profile.controller';
import { TeacherProfilesRepository } from './teacher-profiles.repository';
import { TeacherProfilesService } from './teacher-profiles.service';

/** Reference lookups are `@Global()`, so only the account side has to be imported. */
@Module({
  imports: [AuthModule],
  controllers: [TeacherProfileController],
  providers: [TeacherProfilesService, TeacherProfilesRepository],
})
export class TeacherModule {}
