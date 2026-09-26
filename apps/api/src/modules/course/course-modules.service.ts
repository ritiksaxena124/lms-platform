import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  COURSE_STATUS_CODES,
  LESSON_STATUS_CODES,
  LKP_TYPE_CODES,
  type CourseModule,
} from '@lms/shared';

import { ReferenceService } from '../../reference/reference.service';
import { CoursesRepository } from './courses.repository';
import { CourseModulesRepository } from './course-modules.repository';
import type { CreateCourseModuleDto, UpdateCourseModuleDto } from './dto/course-module.dto';

/** A course id is a uuid or it is a typo, and a typo must not reach Postgres. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toDocument(module: {
  id: string;
  courseId: string;
  title: string;
  summary: string | null;
  description: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}): CourseModule {
  return {
    id: module.id,
    courseId: module.courseId,
    title: module.title,
    summary: module.summary,
    description: module.description,
    position: module.position,
    createdAt: module.createdAt.toISOString(),
    updatedAt: module.updatedAt.toISOString(),
  };
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: API_ERROR_CODES.NOT_FOUND, message });
}

/**
 * The syllabus inside one of a teacher's courses.
 *
 * Ownership is inherited rather than repeated: every entry point resolves the course through
 * `CoursesRepository.findOwned` first, so a module is only ever reachable from a course the
 * caller owns, and both failures answer `NOT_FOUND`. Order is decided here and nowhere else,
 * and the course's lifecycle bites asymmetrically — a teacher adding to a live syllabus gives
 * a student more to read, while taking one away could remove what they are working through.
 */
@Injectable()
export class CourseModulesService {
  constructor(
    private readonly courses: CoursesRepository,
    private readonly modules: CourseModulesRepository,
    private readonly reference: ReferenceService,
  ) {}

  async list(teacherUserId: string, courseId: string): Promise<CourseModule[]> {
    const course = await this.ownedCourse(teacherUserId, courseId);
    return (await this.modules.listActive(course.id)).map(toDocument);
  }

  async create(
    teacherUserId: string,
    courseId: string,
    dto: CreateCourseModuleDto,
  ): Promise<CourseModule> {
    const course = await this.ownedCourse(teacherUserId, courseId);
    const position = (await this.modules.lastPosition(course.id)) + 1;

    return toDocument(
      await this.modules.create(course.id, position, {
        title: dto.title,
        summary: dto.summary?.trim() || null,
        description: dto.description?.trim() || null,
      }),
    );
  }

  /** A rename leaves the slot alone. Only the paragraphs and the title are writable, so
   * there is no way to move a module by editing it. */
  async update(
    teacherUserId: string,
    courseId: string,
    id: string,
    dto: UpdateCourseModuleDto,
  ): Promise<CourseModule> {
    const course = await this.ownedCourse(teacherUserId, courseId);
    const module = await this.inCourse(course.id, id);

    const columns = {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.summary === undefined ? {} : { summary: dto.summary.trim() || null }),
      ...(dto.description === undefined ? {} : { description: dto.description.trim() || null }),
    };

    return toDocument(await this.modules.updateColumns(module.id, columns));
  }

  async reorder(
    teacherUserId: string,
    courseId: string,
    moduleIds: string[],
  ): Promise<CourseModule[]> {
    const course = await this.ownedCourse(teacherUserId, courseId);
    const slots = await this.modules.activeSlots(course.id);

    // The body has to be a permutation of the syllabus: the slots below are the ones the
    // active modules already hold, so an id that is not one of them leaves a slot with
    // nobody in it and the check is which of the two the caller got wrong.
    const held = new Set(slots.map((slot) => slot.id));
    const named = new Set(moduleIds);
    if (
      moduleIds.length !== held.size ||
      moduleIds.some((id) => !held.has(id)) ||
      named.size !== moduleIds.length
    ) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Check the highlighted fields.',
        details: {
          validation: {
            moduleIds: ['Send every module of the course once, in the order you want them.'],
          },
        },
      });
    }

    await this.modules.placeInSlots(slots, moduleIds);
    return (await this.modules.listActive(course.id)).map(toDocument);
  }

  /**
   * Takes a block out of the syllabus — unless it holds a page a student is reading, which is
   * the same two gates the catalog opens on: the course published and a lesson published.
   * The row keeps its slot either way — see `lastPosition` — so nothing later inherits the
   * number a student may have read.
   *
   * An empty block, or one whose every page is still a draft, is not on a student's screen at
   * all, so letting it go is a teacher tidying rather than a promise withdrawn. Refusing that
   * too would strand a block added by mistake under a live course with no answer short of
   * archiving the whole course.
   */
  async deactivate(teacherUserId: string, courseId: string, id: string): Promise<CourseModule> {
    const course = await this.ownedCourse(teacherUserId, courseId);
    const module = await this.inCourse(course.id, id);

    if (course.status.code === COURSE_STATUS_CODES.PUBLISHED) {
      const published = await this.reference.valueId(
        LKP_TYPE_CODES.LESSON_STATUS,
        LESSON_STATUS_CODES.PUBLISHED,
      );
      if (await this.modules.hasPagesToRead(module.id, published)) {
        throw new ConflictException({
          code: API_ERROR_CODES.CONFLICT,
          message:
            'This block still holds a page a student can read. Take those lessons back to a draft first.',
        });
      }
    }

    return toDocument(await this.modules.deactivate(module.id));
  }

  private async ownedCourse(teacherUserId: string, courseId: string) {
    const course = UUID.test(courseId)
      ? await this.courses.findOwned(teacherUserId, courseId)
      : null;
    if (!course) {
      // "Not yours" and "not there" get one answer because the difference is only useful
      // to someone deciding which ids to try next.
      throw notFound('We cannot find that course.');
    }
    return course;
  }

  private async inCourse(courseId: string, id: string) {
    const module = UUID.test(id) ? await this.modules.findInCourse(courseId, id) : null;
    if (!module) throw notFound('We cannot find that module.');
    return module;
  }
}
