import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ROLE_CODES, type AttachLessonAssetResponse, type LessonAssetResponse } from '@lms/shared';
import type { Request, Response } from 'express';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { LessonAssetsService } from './lesson-assets.service';

/**
 * The recording a lesson carries, addressed through the page it belongs to.
 *
 * The path is the lesson's own, with `asset` on the end rather than a collection: there is one
 * standing video per page, the id in the address is the pair the service resolves ownership
 * through, and replacing a recording is what a second upload does instead of a route called
 * `replace`.
 */
@Controller('modules/:moduleId/lessons/:lessonId/asset')
@Roles(ROLE_CODES.TEACHER)
export class LessonAssetsController {
  constructor(private readonly assets: LessonAssetsService) {}

  /** 201 even for the upload that replaces one: a new row is created every time, and the
   * recording it retires stays on the page's record rather than being overwritten. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async attach(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moduleId') moduleId: string,
    @Param('lessonId') lessonId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AttachLessonAssetResponse> {
    return { asset: await this.assets.attach(user.id, moduleId, lessonId, { req, res }) };
  }

  @Get()
  async standing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moduleId') moduleId: string,
    @Param('lessonId') lessonId: string,
  ): Promise<LessonAssetResponse> {
    return { asset: await this.assets.standing(user.id, moduleId, lessonId) };
  }

  /**
   * The recording itself, played back to the teacher whose page carries it.
   *
   * A route that answers with a file takes the response over: the status, the headers and the
   * end of the stream are decided inside the shared ranged reader rather than by a serialiser
   * with no idea what a seek is. It lives on this address and not a public one because the key
   * these bytes live under is the store's business — a URL for a paid recording is exactly what
   * this module was built not to have.
   */
  @Get('video')
  async play(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moduleId') moduleId: string,
    @Param('lessonId') lessonId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.assets.play(user.id, moduleId, lessonId, { req, res });
  }
}
