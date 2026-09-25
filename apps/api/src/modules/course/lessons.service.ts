import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  API_ERROR_CODES,
  COURSE_STATUS_CODES,
  LESSON_STATUS_CODES,
  LKP_TYPE_CODES,
  type Lesson,
} from '@lms/shared';

import { ReferenceService } from '../../reference/reference.service';
import { CourseModulesRepository } from './course-modules.repository';
import type { LessonWithStatus } from './lessons.repository';
import { LessonsRepository } from './lessons.repository';
import type { CreateLessonDto, UpdateLessonDto } from './dto/lesson.dto';

/** A lesson or module id is a uuid or it is a typo, and a typo must not reach Postgres. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toDocument(lesson: LessonWithStatus): Lesson {
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    title: lesson.title,
    body: lesson.body,
    estimatedMinutes: lesson.estimatedMinutes,
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
  ) {}

  async list(teacherUserId: string, moduleId: string): Promise<Lesson[]> {
    const module = await this.ownedModule(teacherUserId, moduleId);
    return (await this.lessons.listActive(module.id)).map(toDocument);
  }

  async create(
    teacherUserId: string,
    moduleId: string,
    dto: CreateLessonDto,
  ): Promise<Lesson> {
    const module = await this.ownedModule(teacherUserId, moduleId);
    const position = (await this.lessons.lastPosition(module.id)) + 1;
    const draft = await this.status(LESSON_STATUS_CODES.DRAFT);

    return toDocument(
      await this.lessons.create(module.id, position, draft, {
        title: dto.title,
        body: dto.body?.trim() || null,
        estimatedMinutes: dto.estimatedMinutes ?? null,
      }),
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
      return await this.move(teacherUserId, lesson.id, dto.moduleId);
    }

    const columns = {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.body === undefined ? {} : { body: dto.body?.trim() || null }),
      ...(dto.estimatedMinutes === undefined
        ? {}
        : { estimatedMinutes: dto.estimatedMinutes }),
    };

    return toDocument(await this.lessons.updateColumns(lesson.id, columns));
  }

  async reorder(
    teacherUserId: string,
    moduleId: string,
    lessonIds: string[],
  ): Promise<Lesson[]> {
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

    await this.lessons.placeInSlots(slots, lessonIds);
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
    return toDocument(await this.lessons.updateStatus(lesson.id, published));
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
    return toDocument(await this.lessons.updateStatus(lesson.id, draft));
  }

  async deactivate(teacherUserId: string, moduleId: string, id: string): Promise<Lesson> {
    const module = await this.ownedModule(teacherUserId, moduleId);

    if (module.course.status.code === COURSE_STATUS_CODES.PUBLISHED) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message:
          'Take the lesson back to a draft to hide it, or archive the course to take it out of the syllabus.',
      });
    }

    const lesson = await this.inModule(module.id, id);
    return toDocument(await this.lessons.deactivate(lesson.id));
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
    lessonId: string,
    targetModuleId: string,
  ): Promise<Lesson> {
    const target = await this.ownedModule(teacherUserId, targetModuleId);
    const position = (await this.lessons.lastPosition(target.id)) + 1;
    return toDocument(await this.lessons.moveTo(lessonId, target.id, position));
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
