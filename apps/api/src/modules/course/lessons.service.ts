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
  LESSON_STATUS_CODES,
  LKP_TYPE_CODES,
  type Lesson,
} from '@lms/shared';

import { ReferenceService } from '../../reference/reference.service';
import { ActionRecorder } from '../action-log/action-recorder';
import { movedFields } from '../action-log/changed-fields';
import { CourseModulesRepository } from './course-modules.repository';
import type { LessonWithStatus } from './lessons.repository';
import { LessonsRepository } from './lessons.repository';
import type { CreateLessonDto, UpdateLessonDto } from './dto/lesson.dto';
import { countMovedSlots } from './slot-moves';

/** A lesson or module id is a uuid or it is a typo, and a typo must not reach Postgres. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The columns a patch writes, in the names the record of an edit should use.
 *
 * `moduleId` and `position` are one field: a page changing block is a decision about where it
 * belongs, and the number it lands on at the end of the new block is arithmetic the log has no
 * reason to duplicate. Same argument as a course's price, opposite conclusion — there two columns
 * made one thing the teacher quoted, here two columns make one thing the teacher chose. */
const FIELD_BY_COLUMN: Record<string, string> = {
  title: 'title',
  body: 'body',
  estimatedMinutes: 'estimatedMinutes',
  isFreePreview: 'isFreePreview',
  moduleId: 'module',
  position: 'module',
};

function toDocument(lesson: LessonWithStatus): Lesson {
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    title: lesson.title,
    body: lesson.body,
    estimatedMinutes: lesson.estimatedMinutes,
    isFreePreview: lesson.isFreePreview,
    position: lesson.position,
    status: { code: lesson.status.code, label: lesson.status.label },
    createdAt: lesson.createdAt.toISOString(),
    updatedAt: lesson.updatedAt.toISOString(),
  };
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: API_ERROR_CODES.NOT_FOUND, message });
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Check the highlighted fields.',
    details: { validation: { [field]: [message] } },
  });
}

/**
 * The pages inside one of a teacher's modules.
 *
 * Ownership is inherited twice over: every entry point resolves the module against the
 * courses the session owns, so a lesson is only ever reachable from a block of a syllabus the
 * caller is writing, and both failures answer `NOT_FOUND`. Order is decided here, per module.
 *
 * A lesson is the first row with a lifecycle of its own, and the two gates are read together:
 * a page is a student's only if its lesson is published *and* its course is, so neither flag
 * can expose the other's unfinished work. That is also what makes an unpublished page
 * recoverable in a way a deleted one is not — which is why `deactivate` is still refused on a
 * live course while `unpublish` is allowed anywhere.
 */
@Injectable()
export class LessonsService {
  constructor(
    private readonly modules: CourseModulesRepository,
    private readonly lessons: LessonsRepository,
    private readonly reference: ReferenceService,
    private readonly actions: ActionRecorder,
  ) {}

  async list(teacherUserId: string, moduleId: string): Promise<Lesson[]> {
    const module = await this.ownedModule(teacherUserId, moduleId);
    return (await this.lessons.listActive(module.id)).map(toDocument);
  }

  async create(teacherUserId: string, moduleId: string, dto: CreateLessonDto): Promise<Lesson> {
    const module = await this.ownedModule(teacherUserId, moduleId);
    const position = (await this.lessons.lastPosition(module.id)) + 1;
    const draft = await this.status(LESSON_STATUS_CODES.DRAFT);

    return toDocument(
      await this.lessons.create(
        module.id,
        position,
        draft,
        {
          title: dto.title,
          body: dto.body?.trim() || null,
          estimatedMinutes: dto.estimatedMinutes ?? null,
        },
        (tx, written) =>
          this.actions.record(tx, {
            action: ACTION_CODES.LESSON_CREATED,
            targetId: written.id,
          }),
      ),
    );
  }

  async update(
    teacherUserId: string,
    moduleId: string,
    id: string,
    dto: UpdateLessonDto,
  ): Promise<Lesson> {
    const module = await this.ownedModule(teacherUserId, moduleId);
    const lesson = await this.inModule(module.id, id);

    if (dto.moduleId !== undefined) {
      return await this.move(teacherUserId, lesson, dto.moduleId);
    }

    const columns = {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.body === undefined ? {} : { body: dto.body?.trim() || null }),
      ...(dto.estimatedMinutes === undefined ? {} : { estimatedMinutes: dto.estimatedMinutes }),
      ...(dto.isFreePreview === undefined ? {} : { isFreePreview: dto.isFreePreview }),
    };

    const changed = movedFields(lesson, columns, FIELD_BY_COLUMN);
    if (changed.length === 0) return toDocument(lesson);

    return toDocument(
      await this.lessons.updateColumns(lesson.id, columns, (tx) =>
        this.actions.record(tx, {
          action: ACTION_CODES.LESSON_UPDATED,
          targetId: lesson.id,
          detail: { changed: changed.join(',') },
        }),
      ),
    );
  }

  async reorder(teacherUserId: string, moduleId: string, lessonIds: string[]): Promise<Lesson[]> {
    const module = await this.ownedModule(teacherUserId, moduleId);
    const slots = await this.lessons.activeSlots(module.id);

    // The body has to be a permutation of the module's pages: the slots below are the ones
    // the active lessons already hold, so an id that is not one of them — including one of
    // this teacher's lessons from a different module — leaves a slot with nobody in it.
    const held = new Set(slots.map((slot) => slot.id));
    const named = new Set(lessonIds);
    if (
      lessonIds.length !== held.size ||
      lessonIds.some((id) => !held.has(id)) ||
      named.size !== lessonIds.length
    ) {
      throw fieldError(
        'lessonIds',
        'Send every lesson of the module once, in the order you want them.',
      );
    }

    // An order sent back unchanged — the same list from a portal that lost its response — moves
    // nothing, so it writes nothing and files nothing.
    const moved = countMovedSlots(slots, lessonIds);
    if (moved === 0) return (await this.lessons.listActive(module.id)).map(toDocument);

    await this.lessons.placeInSlots(slots, lessonIds, (tx) =>
      this.actions.record(tx, {
        // The module is the target, not the pages: what was decided is the order of the block, and
        // a record per lesson would be `moved` rows claiming `moved` decisions.
        action: ACTION_CODES.LESSONS_REORDERED,
        targetId: module.id,
        detail: { moved },
      }),
    );
    return (await this.lessons.listActive(module.id)).map(toDocument);
  }

  /** Publishing is the only way a page reaches a student, so it is where an empty one is
   * caught — the field error names the box the portal can highlight. */
  async publish(teacherUserId: string, moduleId: string, id: string): Promise<Lesson> {
    const lesson = await this.inOwnedModule(teacherUserId, moduleId, id);

    if (lesson.status.code !== LESSON_STATUS_CODES.DRAFT) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only a draft lesson can be published.',
      });
    }
    if (!lesson.body?.trim()) {
      throw fieldError('body', 'Write the page before publishing it.');
    }

    const published = await this.status(LESSON_STATUS_CODES.PUBLISHED);
    return toDocument(
      await this.lessons.updateStatus(lesson.id, published, (tx) =>
        this.actions.record(tx, {
          action: ACTION_CODES.LESSON_PUBLISHED,
          targetId: lesson.id,
          detail: { from: lesson.status.code, to: LESSON_STATUS_CODES.PUBLISHED },
        }),
      ),
    );
  }

  /** Allowed wherever `deactivate` is not: taking a page out of what a student is reading by
   * putting it back into the author's hands, rather than by erasing it from a syllabus. */
  async unpublish(teacherUserId: string, moduleId: string, id: string): Promise<Lesson> {
    const lesson = await this.inOwnedModule(teacherUserId, moduleId, id);

    if (lesson.status.code !== LESSON_STATUS_CODES.PUBLISHED) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only a published lesson can go back to a draft.',
      });
    }

    const draft = await this.status(LESSON_STATUS_CODES.DRAFT);
    return toDocument(
      await this.lessons.updateStatus(lesson.id, draft, (tx) =>
        this.actions.record(tx, {
          action: ACTION_CODES.LESSON_UNPUBLISHED,
          targetId: lesson.id,
          detail: { from: lesson.status.code, to: LESSON_STATUS_CODES.DRAFT },
        }),
      ),
    );
  }

  /**
   * Removing a page is refused on exactly the condition that the catalog reads it: both
   * gates open at once. A published page under a published course is something a student may
   * have a link to, be partway through, or have written down — so it goes back to a draft
   * first, which is the reversible move. Either gate closed means nobody is reading it, and a
   * teacher tidying away a page no student has ever been shown is not taking anything from
   * anybody; refusing that would leave half-written pages stuck in a live syllabus.
   */
  async deactivate(teacherUserId: string, moduleId: string, id: string): Promise<Lesson> {
    const module = await this.ownedModule(teacherUserId, moduleId);
    const lesson = await this.inModule(module.id, id);

    const readable =
      module.course.status.code === COURSE_STATUS_CODES.PUBLISHED &&
      lesson.status.code === LESSON_STATUS_CODES.PUBLISHED;
    if (readable) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message:
          'A page a student can read goes back to a draft first — unpublish it, then take it out of the syllabus.',
      });
    }

    return toDocument(
      await this.lessons.deactivate(lesson.id, (tx) =>
        this.actions.record(tx, {
          action: ACTION_CODES.LESSON_DEACTIVATED,
          targetId: lesson.id,
        }),
      ),
    );
  }

  /**
   * A page leaving one block for another joins the end of the second's order.
   *
   * The number it held is not kept for it: a retired lesson stays in the module and so keeps
   * its slot out of the append arithmetic, while a moved one has gone and the block it left
   * has nothing pointing at it. The id is what survives a move, which is what a link is for.
   */
  private async move(
    teacherUserId: string,
    lesson: LessonWithStatus,
    targetModuleId: string,
  ): Promise<Lesson> {
    const target = await this.ownedModule(teacherUserId, targetModuleId);
    const position = (await this.lessons.lastPosition(target.id)) + 1;

    // Filed as `lesson_updated` with one field, because a page changing block is an edit of where
    // it belongs rather than a fifth lifecycle: there is no `lesson_moved` in the vocabulary, and
    // the two columns the write touches are one decision about one thing.
    const changed = movedFields(lesson, { moduleId: target.id, position }, FIELD_BY_COLUMN);
    if (changed.length === 0) return toDocument(lesson);

    return toDocument(
      await this.lessons.moveTo(lesson.id, target.id, position, (tx) =>
        this.actions.record(tx, {
          action: ACTION_CODES.LESSON_UPDATED,
          targetId: lesson.id,
          detail: { changed: changed.join(',') },
        }),
      ),
    );
  }

  private async status(code: string) {
    return this.reference.valueId(LKP_TYPE_CODES.LESSON_STATUS, code);
  }

  /** Both the lesson and the module it was reached through, for the transitions that read
   * the lesson's own status and nothing about the course. */
  private async inOwnedModule(
    teacherUserId: string,
    moduleId: string,
    id: string,
  ): Promise<LessonWithStatus> {
    const module = await this.ownedModule(teacherUserId, moduleId);
    return this.inModule(module.id, id);
  }

  private async ownedModule(teacherUserId: string, moduleId: string) {
    const module = UUID.test(moduleId)
      ? await this.modules.findOwned(teacherUserId, moduleId)
      : null;
    if (!module) {
      // As with a course, "not yours" and "not there" get one answer: the difference is only
      // useful to someone deciding which ids to try next.
      throw notFound('We cannot find that module.');
    }
    return module;
  }

  private async inModule(moduleId: string, id: string): Promise<LessonWithStatus> {
    const lesson = UUID.test(id) ? await this.lessons.findInModule(moduleId, id) : null;
    if (!lesson) throw notFound('We cannot find that lesson.');
    return lesson;
  }
}
