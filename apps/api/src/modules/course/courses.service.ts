import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTION_CODES,
  API_ERROR_CODES,
  COURSE_STATUS_CODES,
  LKP_TYPE_CODES,
  type Course,
  type CourseChoice,
} from '@lms/shared';

import type { ReferenceValue } from '../../reference/reference.service';
import { ReferenceService } from '../../reference/reference.service';
import { ActionRecorder } from '../action-log/action-recorder';
import { movedFields } from '../action-log/changed-fields';
import type { CourseColumns, CourseWithVocabulary } from './courses.repository';
import { CoursesRepository } from './courses.repository';
import type { CoursePriceDto, CreateCourseDto, UpdateCourseDto } from './dto/course.dto';

/** A course row is addressed by its id and nothing else, so this is the whole of it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The price columns as a writer sees them: a pair, because an amount standing over no
 * currency is a number a student cannot read, and a currency standing over no amount is a
 * unit nobody quoted. */
type PriceColumns = Pick<CourseColumns, 'priceMinorUnits' | 'priceCurrencyValueId'>;

const NO_PRICE: PriceColumns = { priceMinorUnits: null, priceCurrencyValueId: null };

/** The columns a patch writes, in the names the record of the edit should use.
 *
 * `price` is one field over two columns, because the pair is the rule and a record saying the edit
 * moved two things when the teacher moved one would be a record of the implementation. The lifecycle
 * columns are absent because this patch cannot reach them — `publish` and `archive` file their own
 * rows, with the transition in them. */
const FIELD_BY_COLUMN: Record<string, string> = {
  title: 'title',
  slug: 'slug',
  summary: 'summary',
  description: 'description',
  levelValueId: 'level',
  priceMinorUnits: 'price',
  priceCurrencyValueId: 'price',
};

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
    // One object or nothing: the two columns are written as a pair, so a course that had an
    // amount and no currency would be a bug rather than a price worth showing.
    price:
      course.priceMinorUnits === null || course.priceCurrency === null
        ? null
        : { minorUnits: course.priceMinorUnits, currency: course.priceCurrency },
    demoBookingsEnabled: course.demoBookingsEnabled,
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
    private readonly actions: ActionRecorder,
  ) {}

  async create(teacherUserId: string, dto: CreateCourseDto): Promise<Course> {
    const level = await this.level(dto.level);
    const draft = await this.status(COURSE_STATUS_CODES.DRAFT);
    const price = await this.priceWrite(dto.price);

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
        // A create that said nothing about money is a course with no price on it, which is
        // the same row a later patch clears.
        ...(price ?? NO_PRICE),
      },
      draft.id,
      // The row the insert just made, not the `course` this call is still waiting for: the record is
      // filed inside the transaction, before the create has a value to return.
      (tx, written) =>
        this.actions.record(tx, {
          action: ACTION_CODES.COURSE_CREATED,
          targetId: written.id,
        }),
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

  /** The currencies a price can be quoted in. The picker is given the label to show and the
   * code to send, so a currency Ops enables is an option in the form the day it is a row. */
  async currencies(): Promise<CourseChoice[]> {
    const values = await this.reference.activeValues(LKP_TYPE_CODES.CURRENCY);
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
        message: 'Unpublish the course to change what a student is reading.',
      });
    }

    const columns = {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.summary === undefined ? {} : { summary: dto.summary.trim() || null }),
      ...(dto.description === undefined ? {} : { description: dto.description.trim() || null }),
      ...(dto.level === undefined ? {} : { levelValueId: (await this.level(dto.level)).id }),
      ...(dto.slug === undefined ? {} : { slug: dto.slug }),
      // The one field with three answers: say nothing and the quote stands, say `null` and
      // both columns go back, name a currency and an amount and both are written.
      ...(await this.priceWrite(dto.price)),
    };

    if (dto.slug && dto.slug !== course.slug) {
      await this.requireSlugFree(teacherUserId, dto.slug, course.id);
    }

    // What moved, not what was sent. A form that posts the title back unchanged edited nothing, and
    // the second half of 7a's rule is that a write which changed nothing earns no row — so the
    // statement is skipped as well as the record, and `updatedAt` stays where the edit left it.
    const changed = movedFields(course, columns, FIELD_BY_COLUMN);
    if (changed.length === 0) return toDocument(course);

    const updated = await this.courses.updateColumns(course.id, columns, (tx) =>
      this.actions.record(tx, {
        action: ACTION_CODES.COURSE_UPDATED,
        targetId: course.id,
        detail: { changed: changed.join(',') },
      }),
    );
    return toDocument(updated);
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
            missing.map((field) => [field, ['Fill this in before publishing.']]),
          ),
        },
      });
    }

    const published = await this.status(COURSE_STATUS_CODES.PUBLISHED);
    return toDocument(
      await this.courses.updateStatus(course.id, published.id, (tx) =>
        this.actions.record(tx, {
          action: ACTION_CODES.COURSE_PUBLISHED,
          targetId: course.id,
          detail: { from: course.status.code, to: COURSE_STATUS_CODES.PUBLISHED },
        }),
      ),
    );
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
    return toDocument(
      await this.courses.updateStatus(course.id, archived.id, (tx) =>
        this.actions.record(tx, {
          action: ACTION_CODES.COURSE_ARCHIVED,
          targetId: course.id,
          detail: { from: course.status.code, to: COURSE_STATUS_CODES.ARCHIVED },
        }),
      ),
    );
  }

  /**
   * Take a live course back to a draft.
   *
   * The reverse of `publish`, and deliberately not a fourth status: a course that is not on the
   * shelf is in the same position it started in — editable, unreadable by a stranger — and a
   * `paused` or `unpublished` code would ask the catalog and the roster which of the three states
   * a student still holding a place belongs to. Landing in `draft` means the one transition that
   * checks what a student would read has to be passed again to go back out, and that the fields
   * the teacher wanted to change are changeable the moment the course is off the shelf.
   *
   * Students already enrolled keep reading it. That is the promise a place makes, and an
   * unpublished page is a decision about who new can join, not a retraction of what somebody
   * already bought — the same reasoning that keeps an archived course's roster intact.
   */
  async unpublish(teacherUserId: string, id: string): Promise<Course> {
    const course = await this.owned(teacherUserId, id);

    if (course.status.code !== COURSE_STATUS_CODES.PUBLISHED) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only a published course can be unpublished.',
      });
    }

    const draft = await this.status(COURSE_STATUS_CODES.DRAFT);
    return toDocument(
      await this.courses.updateStatus(course.id, draft.id, (tx) =>
        this.actions.record(tx, {
          action: ACTION_CODES.COURSE_UNPUBLISHED,
          targetId: course.id,
          detail: { from: course.status.code, to: COURSE_STATUS_CODES.DRAFT },
        }),
      ),
    );
  }

  /**
   * Bring an archived course back, as a draft.
   *
   * A run that ends in November is written up again in January, and the work in between is editing
   * — so unarchiving goes to the editable state and not onto the shelf. Straight to published would
   * be the shortcut this lifecycle keeps refusing: it would put a course in front of students that
   * nobody has re-read since it was filed away, without ever running the check that publish runs.
   */
  async unarchive(teacherUserId: string, id: string): Promise<Course> {
    const course = await this.owned(teacherUserId, id);

    if (course.status.code !== COURSE_STATUS_CODES.ARCHIVED) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only an archived course can be brought back.',
      });
    }

    const draft = await this.status(COURSE_STATUS_CODES.DRAFT);
    return toDocument(
      await this.courses.updateStatus(course.id, draft.id, (tx) =>
        this.actions.record(tx, {
          action: ACTION_CODES.COURSE_UNARCHIVED,
          targetId: course.id,
          detail: { from: course.status.code, to: COURSE_STATUS_CODES.DRAFT },
        }),
      ),
    );
  }

  /**
   * Open or close this course to a trial call from a student who has not taken a place.
   *
   * No status check, which is the one transition-shaped thing here that does not have one: the
   * booking gate already refuses a demo on a course that is not published, so a flag set on a
   * draft is not a hole but a decision waiting for its course to go live. Refusing it would ask a
   * teacher to publish first and only then be allowed to say what they want the published thing to
   * offer.
   *
   * Setting it to what it already is succeeds and writes nothing new, for the reason every other
   * switch here works that way: a portal's response can be lost on the way home, and the second
   * press of the same switch should say the same thing as the first.
   */
  async setDemoBookings(
    teacherUserId: string,
    id: string,
    demoBookingsEnabled: boolean,
  ): Promise<Course> {
    const course = await this.owned(teacherUserId, id);
    if (course.demoBookingsEnabled === demoBookingsEnabled) {
      // The switch was already where the teacher wants it: same answer, no write, no record — the
      // log that says they opened trials twice is a log that cannot be counted.
      return toDocument(course);
    }

    return toDocument(
      await this.courses.setDemoBookings(course.id, demoBookingsEnabled, (tx) =>
        this.actions.record(tx, {
          action: ACTION_CODES.COURSE_DEMO_BOOKINGS_CHANGED,
          targetId: course.id,
          detail: { from: course.demoBookingsEnabled, to: demoBookingsEnabled },
        }),
      ),
    );
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

  /**
   * The price columns a body asks for, or `null` when the body did not mention a price.
   *
   * Both halves are resolved here and nowhere else, because the pair is the rule: an amount
   * with no unit is not a price, and a unit with no amount is not one either. A currency the
   * catalogue does not carry is the writer's mistake, so it is reported against the `price`
   * field the way an unknown level is reported against `level` — and the lookup is scoped to
   * the Currency type, which is what stops `beginner` from being a valid thing to quote in.
   */
  private async priceWrite(price?: CoursePriceDto | null): Promise<PriceColumns | null> {
    if (price === undefined) return null;
    if (price === null) return NO_PRICE;

    const [currency] = await this.reference.valuesByCodes(LKP_TYPE_CODES.CURRENCY, [
      price.currency,
    ]);
    if (!currency) throw fieldError('price', `Not a currency we know: ${price.currency}`);

    return { priceMinorUnits: price.minorUnits, priceCurrencyValueId: currency.id };
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
    const course = UUID.test(id) ? await this.courses.findOwned(teacherUserId, id) : null;
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
