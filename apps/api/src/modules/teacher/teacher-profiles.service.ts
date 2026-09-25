import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { API_ERROR_CODES, LKP_TYPE_CODES } from '@lms/shared';

import { ReferenceService } from '../../reference/reference.service';
import { UsersRepository } from '../auth/users.repository';
import { TeacherProfilesRepository, type ProfileWithSubjects } from './teacher-profiles.repository';
import type { UpdateTeacherProfileDto } from './dto/update-profile.dto';

export interface TeacherProfileDocument {
  headline: string | null;
  bio: string | null;
  subjects: { code: string; label: string }[];
  timezone: string;
  hourlyRateMinorUnits: number | null;
  currency: string | null;
  updatedAt: string;
}

function toDocument(profile: ProfileWithSubjects, timezone: string): TeacherProfileDocument {
  return {
    headline: profile.headline,
    bio: profile.bio,
    subjects: profile.subjects.map((row) => ({
      code: row.subject.code,
      label: row.subject.label,
    })),
    timezone,
    hourlyRateMinorUnits: profile.hourlyRateMinorUnits,
    currency: profile.currencyCode,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

/**
 * The teacher's own words about their teaching, plus the one decision that does not belong
 * to this table: where in the world they are. The zone is written onto the account because
 * it governs scheduling and login reminders too, and a profile copy of it would be a second
 * truth to keep in step.
 */
@Injectable()
export class TeacherProfilesService {
  constructor(
    private readonly profiles: TeacherProfilesRepository,
    private readonly reference: ReferenceService,
    private readonly users: UsersRepository,
  ) {}

  async read(userId: string): Promise<TeacherProfileDocument | null> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.TOKEN_INVALID,
        message: 'Session is not recognised.',
      });
    }

    const profile = await this.profiles.findForUser(userId);
    return profile ? toDocument(profile, user.timezone) : null;
  }

  async save(userId: string, dto: UpdateTeacherProfileDto): Promise<TeacherProfileDocument> {
    const subjects = await this.reference.valuesByCodes(LKP_TYPE_CODES.SUBJECT, dto.subjects);
    const known = new Set(subjects.map((subject) => subject.code));
    const unknown = dto.subjects.filter((code) => !known.has(code));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Check the highlighted fields.',
        details: {
          validation: {
            subjects: [`Not a subject we know: ${unknown.join(', ')}`],
          },
        },
      });
    }

    await this.users.updateTimezone(userId, dto.timezone);
    const profile = await this.profiles.save(userId, {
      headline: dto.headline,
      bio: dto.bio?.trim() || null,
      hourlyRateMinorUnits: dto.hourlyRateMinorUnits ?? null,
      currencyCode: dto.currency ?? null,
      subjectValueIds: subjects.map((subject) => subject.id),
    });

    return toDocument(profile, dto.timezone);
  }
}
