import { Controller, Get, Param, Query } from '@nestjs/common';
import type {
  CatalogCourseListResponse,
  CatalogCourseResponse,
  CatalogLessonResponse,
  CourseChoice,
} from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { OptionalCurrentUser } from '../auth/current-user.decorator';
import { OptionalSession } from '../auth/optional-session.decorator';
import { Public } from '../auth/public.decorator';
import { CatalogService } from './catalog.service';
import { ListCatalogQueryDto } from './dto/list-catalog-query.dto';

/**
 * What a student may read of a course they do not own, whether or not they hold a place in it.
 *
 * `@Public()` is the whole reason this controller is a separate module: every other route in
 * the API is a teacher's own work, addressed through who signed in. These are not — there is no
 * ownership to resolve, and the gate that decides what appears here is the row's own status
 * rather than a relationship to a user. Keeping the two kinds of read in different files is what
 * stops "who owns this?" from becoming a question every endpoint has to remember to answer.
 *
 * Two routes make an exception with `@OptionalSession()`: a course's outline, and one of its
 * pages. Both answer a second question that is about the caller — do you hold a place here
 * (§12)? — and both take it without demanding it, so a stranger still reaches the shelf, the
 * syllabus and the page the teacher left open. Neither gained a twin under the enrollment
 * module, because the question is the same one in all three places — which of these gates is
 * open? — and a second copy of the answer is a second chance to get it wrong.
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

  /** The course's own page: the syllabus, and on it which rows this reader may open. A place
   * in the course is a fact about the caller rather than the course, so the session is
   * optional here for the same reason it is on the page route below — and the answer changes
   * one boolean, never the list of rows. */
  @Get(':id')
  @OptionalSession()
  async read(
    @Param('id') id: string,
    @OptionalCurrentUser() user?: AuthenticatedUser,
  ): Promise<CatalogCourseResponse> {
    return { course: await this.catalog.read(id, user?.id) };
  }

  /** The one catalog route that answers with a page's text. It opens for two reasons: a
   * teacher marked the row free to read, or the caller holds a place in the course. The
   * session is optional so a stranger can still reach the first, and the course in the path
   * is not decoration — it is half the address, so a lesson id found in someone else's
   * syllabus earns the same silence as one never written. */
  @Get(':id/lessons/:lessonId')
  @OptionalSession()
  async lesson(
    @Param('id') id: string,
    @Param('lessonId') lessonId: string,
    @OptionalCurrentUser() user?: AuthenticatedUser,
  ): Promise<CatalogLessonResponse> {
    return { lesson: await this.catalog.lesson(id, lessonId, user?.id) };
  }
}
