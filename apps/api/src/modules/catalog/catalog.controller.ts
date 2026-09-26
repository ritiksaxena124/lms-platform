import { Controller, Get, Param, Query } from '@nestjs/common';
import type {
  CatalogCourseListResponse,
  CatalogCourseResponse,
  CatalogLessonResponse,
  CourseChoice,
} from '@lms/shared';

import { Public } from '../auth/public.decorator';
import { CatalogService } from './catalog.service';
import { ListCatalogQueryDto } from './dto/list-catalog-query.dto';

/**
 * What a student may read before they are anybody's enrolled learner.
 *
 * `@Public()` is the whole reason this controller is a separate module: every other route in
 * the API is a teacher's own work, addressed through who signed in. These are not — there is
 * no caller to identify, and so no ownership to resolve, and the gate that decides what
 * appears here is the row's own status rather than a relationship to a user. Keeping the two
 * kinds of read in different files is what stops "who owns this?" from becoming a question
 * every endpoint has to remember to answer.
 */
@Controller('catalog/courses')
@Public()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  async list(@Query() query: ListCatalogQueryDto): Promise<CatalogCourseListResponse> {
    return this.catalog.list(query);
  }

  /** Declared before `:id`, because a path that could read as an id is the one case where
   * ordering is the whole difference between a list of levels and a 404. */
  @Get('levels')
  async levels(): Promise<{ items: CourseChoice[] }> {
    return { items: await this.catalog.levels() };
  }

  @Get(':id')
  async read(@Param('id') id: string): Promise<CatalogCourseResponse> {
    return { course: await this.catalog.read(id) };
  }

  /** The one catalog route that answers with a page's text, and only for a page the teacher
   * marked free to read. The course in the path is not decoration: it is half the address, so
   * a lesson id found in someone else's syllabus earns the same silence as one never written. */
  @Get(':id/lessons/:lessonId')
  async lesson(
    @Param('id') id: string,
    @Param('lessonId') lessonId: string,
  ): Promise<CatalogLessonResponse> {
    return { lesson: await this.catalog.freeLesson(id, lessonId) };
  }
}
