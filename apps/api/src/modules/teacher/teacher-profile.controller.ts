import { Body, Controller, Get, Put } from '@nestjs/common';
import { ROLE_CODES } from '@lms/shared';

import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
// A value import, not `import type`: the validation pipe finds the DTO through the
// parameter's emitted metadata, and an erased class turns every body into an unchecked
// `Object` — the endpoint answers 200 to garbage and nothing else notices.
import { UpdateTeacherProfileDto } from './dto/update-profile.dto';
import { TeacherProfilesService, type TeacherProfileDocument } from './teacher-profiles.service';

/**
 * A teacher editing their own profile: the id comes from the session, never the body, so
 * there is no route here that can write someone else's rate. `@Roles` is enforced on the
 * server — the portal hiding the screen is a convenience, not the check.
 */
@Controller('teacher/profile')
@Roles(ROLE_CODES.TEACHER)
export class TeacherProfileController {
  constructor(private readonly profiles: TeacherProfilesService) {}

  @Get()
  async read(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ profile: TeacherProfileDocument | null }> {
    return { profile: await this.profiles.read(user.id) };
  }

  @Put()
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTeacherProfileDto,
  ): Promise<{ profile: TeacherProfileDocument }> {
    return { profile: await this.profiles.save(user.id, dto) };
  }
}
