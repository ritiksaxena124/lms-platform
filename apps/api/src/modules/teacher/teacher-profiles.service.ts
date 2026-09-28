import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ACTION_CODES, API_ERROR_CODES, LKP_TYPE_CODES } from '@lms/shared';

import { ReferenceService } from '../../reference/reference.service';
import { ActionRecorder } from '../action-log/action-recorder';
import { movedFields } from '../action-log/changed-fields';
import { UsersRepository, type UserWithCodes } from '../auth/users.repository';
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
 * The columns a save writes, in the names the record of the save should use.
 *
 * `rate` is one field over two columns, because an amount and a currency are one quote. `subjects`
 * is absent because it is a set of rows rather than a column, and the zone is absent because it is
 * not on this table at all — both are answered beside this map, and the record still says one thing
 * moved for each of them, because that is what the teacher decided.
 */
const FIELD_BY_COLUMN: Record<string, string> = {
  headline: 'headline',
  bio: 'bio',
  hourlyRateMinorUnits: 'rate',
  currencyCode: 'rate',
};

/** Whether this save is reaching for a different set of subjects rather than a different order.
 * The portal lists them in the catalogue's order on the read, so the sequence a teacher pasted them
 * in carries no decision and earns no record. */
function sameSubjects(standing: ProfileWithSubjects, codes: string[]): boolean {
  const before = new Set(standing.subjects.map((row) => row.subject.code));
  const after = new Set(codes);

  return before.size === after.size && [...after].every((code) => before.has(code));
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
    private readonly actions: ActionRecorder,
  ) {}

  async read(userId: string): Promise<TeacherProfileDocument | null> {
    const user = await this.account(userId);
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

    const user = await this.account(userId);
    const standing = await this.profiles.findForUser(userId);
    const columns = {
      headline: dto.headline,
      bio: dto.bio?.trim() || null,
      hourlyRateMinorUnits: dto.hourlyRateMinorUnits ?? null,
      currencyCode: dto.currency ?? null,
    };
    // `null` is the account's cue to stay put: a save that left the zone alone has no reason to
    // stamp the row with the instant it was already holding it.
    const timezone = dto.timezone === user.timezone ? null : dto.timezone;

    const changed = [
      ...new Set([
        ...movedFields(standing ?? {}, columns, FIELD_BY_COLUMN),
        ...(standing && sameSubjects(standing, dto.subjects) ? [] : ['subjects']),
        ...(timezone === null ? [] : ['timezone']),
      ]),
    ].sort();

    // The form posted back what it loaded, so this save decided nothing: no write, no record, and
    // no `updatedAt` moved on a document nobody changed.
    if (standing && changed.length === 0) return toDocument(standing, user.timezone);

    const profile = await this.profiles.save(
      userId,
      { ...columns, subjectValueIds: subjects.map((subject) => subject.id) },
      timezone,
      (tx, written) =>
        this.actions.record(tx, {
          action: ACTION_CODES.TEACHER_PROFILE_SAVED,
          targetId: written.id,
          detail: { changed: changed.join(',') },
        }),
    );

    return toDocument(profile, dto.timezone);
  }

  private async account(userId: string): Promise<UserWithCodes> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.TOKEN_INVALID,
        message: 'Session is not recognised.',
      });
    }
    return user;
  }
}
