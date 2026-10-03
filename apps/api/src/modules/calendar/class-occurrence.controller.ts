import { Controller, Get, Query } from '@nestjs/common';
import {
  PERMISSION_CODES,
  type LearningClassesResponse,
  type TeachingClassesResponse,
} from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { ClassOccurrenceService } from './class-occurrence.service';
import { ListClassesQueryDto } from './dto/list-classes-query.dto';

/**
 * The dated classes, read by the two people who each need a different question answered.
 *
 * There is no write here, and that is the route's whole design. A dated class is not a thing a
 * caller may ask for: it is what a teacher's plan came to at a particular minute, and the only
 * person who can change it is the teacher who edits the plan or marks the day off — both of which
 * run the sweep that §2c's service owns. A `POST /classes` would be a way to put a lesson on a
 * calendar nobody scheduled, and a `PATCH` a way to move a class out from under the register of
 * names beside it.
 *
 * The two doors are split by *whose* calendar rather than by role for ceremony. A teacher asks who
 * they are teaching; a student asks what they are standing for. The same rows answer both, but a
 * single list would have to carry both people's names on every row, and neither of them reads the
 * other's — a student does not choose classes by how many others came, and a teacher does not
 * teach by counting their own attendance marks.
 */
@Controller('classes')
export class ClassOccurrenceController {
  constructor(private readonly occurrences: ClassOccurrenceService) {}

  /** Every class this teacher teaches in the window, soonest first, with the number standing for it. */
  @Get('teaching')
  @Permissions(PERMISSION_CODES.CLASS_TEACH)
  async teaching(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListClassesQueryDto,
  ): Promise<TeachingClassesResponse> {
    return this.occurrences.teaching(user.id, query);
  }

  /** Every class this student holds a place in, soonest first, carrying their own mark or nothing. */
  @Get('learning')
  @Permissions(PERMISSION_CODES.CLASS_ATTEND)
  async learning(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListClassesQueryDto,
  ): Promise<LearningClassesResponse> {
    return this.occurrences.learning(user.id, query);
  }
}
