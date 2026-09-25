import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  API_ERROR_CODES,
  COURSE_STATUS_CODES,
  LKP_TYPE_CODES,
  type Course,
  type CourseChoice,
} from '@lms/shared';

import type { ReferenceValue } from '../../reference/reference.service';
import { ReferenceService } from '../../reference/reference.service';
import type { CourseWithVocabulary } from './courses.repository';
import { CoursesRepository } from './courses.repository';
import type { CreateCourseDto, UpdateCourseDto } from './dto/course.dto';

/** A course row is addressed by its id and nothing else, so this is the whole of it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A title is a sentence and a slug is a URL segment; this is the translation a teacher
 * expects without asking for it. Only the characters a segment can hold survive, and an
 * empty result falls back to the caller's own default rather than inventing `---`.
 */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : '';
}

function toDocument(course: CourseWithVocabulary): Course {
  return {
    id: course.id,
    title: course.title,
    slug: course.slug,
    summary: course.summary,
    description: course.description,
    level: { code: course.level.code, label: course.level.label },
    status: { code: course.status.code, label: course.status.label },
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  };
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Check the highlighted fields.',
    details: { validation: { [field]: [message] } },
  });
}

/**
 * The course a teacher writes, and the only place its lifecycle is decided.
 *
 * Two rules shape everything below. Ownership is answered with `NOT_FOUND`, so a colleague
 * probing ids learns nothing about what exists. And the status column moves only through
 * `publish` and `archive`, each with a precondition — which is why an ordinary edit of a
 * published course is refused: a student reading a description is reading a promise.
 */
@Injectable()
export class CoursesService {
  constructor(
    private readonly courses: CoursesRepository,
    private readonly reference: ReferenceService,
  ) {}

  async create(teacherUserId: string, dto: CreateCourseDto): Promise<Course> {
    const level = await this.level(dto.level);
    const draft = await this.status(COURSE_STATUS_CODES.DRAFT);

    const slug = dto.slug ?? slugify(dto.title);
    if (!slug) {
      throw fieldError('slug', 'Give the course a title that can become a web address.');
    }
    await this.requireSlugFree(teacherUserId, slug);

    const course = await this.courses.create(
      teacherUserId,
      {
        title: dto.title,
        slug,
        summary: dto.summary?.trim() || null,
        description: dto.description?.trim() || null,
        levelValueId: level.id,
      },
      draft.id,
    );

    return toDocument(course);
  }

  /** The levels a course can be tagged, in the order the catalogue sets. The portal renders
   * this instead of keeping three strings of its own, which is the whole argument for
   * reference rows. */
  async levels(): Promise<CourseChoice[]> {
    const values = await this.reference.activeValues(LKP_TYPE_CODES.COURSE_LEVEL);
    return values.map(({ code, label }) => ({ code, label }));
  }

  async list(teacherUserId: string, statusCode?: string): Promise<Course[]> {
    const status = statusCode ? await this.status(statusCode) : null;
    const courses = await this.courses.listForTeacher(teacherUserId, status?.id ?? null);
    return courses.map(toDocument);
  }

  async read(teacherUserId: string, id: string): Promise<Course> {
    return toDocument(await this.owned(teacherUserId, id));
  }

  async update(teacherUserId: string, id: string, dto: UpdateCourseDto): Promise<Course> {
    const course = await this.owned(teacherUserId, id);

    if (course.status.code === COURSE_STATUS_CODES.PUBLISHED) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Archive the course to change what a student is reading.',
      });
    }

    const columns = {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.summary === undefined ? {} : { summary: dto.summary.trim() || null }),
      ...(dto.description === undefined ? {} : { description: dto.description.trim() || null }),
      ...(dto.level === undefined ? {} : { levelValueId: (await this.level(dto.level)).id }),
      ...(dto.slug === undefined ? {} : { slug: dto.slug }),
    };

    if (dto.slug && dto.slug !== course.slug) {
      await this.requireSlugFree(teacherUserId, dto.slug, course.id);
    }

    return toDocument(await this.courses.updateColumns(course.id, columns));
  }

  async publish(teacherUserId: string, id: string): Promise<Course> {
    const course = await this.owned(teacherUserId, id);

    if (course.status.code !== COURSE_STATUS_CODES.DRAFT) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only a draft can be published.',
      });
    }

    const missing = [
      ...(course.summary?.trim() ? [] : ['summary']),
      ...(course.description?.trim() ? [] : ['description']),
    ];
    if (missing.length > 0) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'A course needs a summary and a description before anyone can read it.',
        details: {
          validation: Object.fromEntries(
            missing.map((field) => [field, ['Fill this in before publishing.']])
          ),
        },
      });
    }

    const published = await this.status(COURSE_STATUS_CODES.PUBLISHED);
    return toDocument(await this.courses.updateStatus(course.id, published.id));
  }

  async archive(teacherUserId: string, id: string): Promise<Course> {
    const course = await this.owned(teacherUserId, id);

    if (course.status.code !== COURSE_STATUS_CODES.PUBLISHED) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only a published course can be archived.',
      });
    }

    const archived = await this.status(COURSE_STATUS_CODES.ARCHIVED);
    return toDocument(await this.courses.updateStatus(course.id, archived.id));
  }

  /** A code the catalogue does not carry is the teacher's mistake, not the API's, so it
   * comes back as a field error the form can highlight. */
  private async level(code: string): Promise<ReferenceValue> {
    const [value] = await this.reference.valuesByCodes(LKP_TYPE_CODES.COURSE_LEVEL, [code]);
    if (!value) throw fieldError('level', `Not a level we know: ${code}`);
    return value;
  }

  private async status(code: string): Promise<ReferenceValue> {
    const [value] = await this.reference.valuesByCodes(LKP_TYPE_CODES.COURSE_STATUS, [code]);
    if (!value) throw fieldError('status', `Not a course status we know: ${code}`);
    return value;
  }

  private async requireSlugFree(teacherUserId: string, slug: string, exceptCourseId?: string) {
    if ((await this.courses.slugTakenBy(teacherUserId, slug, exceptCourseId)) > 0) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Check the highlighted fields.',
        details: {
          validation: { slug: [`You already use ${slug} for another course.`] },
        },
      });
    }
  }

  private async owned(teacherUserId: string, id: string): Promise<CourseWithVocabulary> {
    // Postgres answers a malformed uuid with a syntax error, which would reach the client
    // as a 500 about someone's typo. A uuid that cannot exist is simply not found.
    const course = UUID.test(id)
      ? await this.courses.findOwned(teacherUserId, id)
      : null;
    if (!course) {
      // One message for "not yours" and "not there": the difference is only interesting
      // to someone deciding which ids to try next.
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that course.',
      });
    }
    return course;
  }
}
