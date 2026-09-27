import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { API_ERROR_CODES, type LessonAsset } from '@lms/shared';
import type { LessonAsset as LessonAssetRow } from '@prisma/client';
import type { Request, Response } from 'express';

import { ENV } from '../../config/env.module';
import type { AppEnv } from '../../config/env';
import { missingRecording, streamLessonVideo } from '../../common/http/lesson-video';
import { STORAGE, type Storage } from '../../providers/storage/storage.port';
import { CourseModulesRepository } from './course-modules.repository';
import { readLessonVideo } from './lesson-asset-upload';
import { LessonAssetsRepository } from './lesson-assets.repository';
import { LessonsRepository } from './lessons.repository';

/** A lesson or module id is a uuid or it is a typo, and a typo must not reach Postgres. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The row on the wire: what a recording is called, what it holds and how big it is.
 *
 * `storedKey` is left out on purpose. It is the store's address for the bytes, and this platform
 * has decided those bytes have no address of their own: a client that learned the key would be
 * looking for a URL to open, and the only honest answer is that the read route is the door.
 */
function toAsset(row: LessonAssetRow): LessonAsset {
  return {
    id: row.id,
    lessonId: row.lessonId,
    displayName: row.displayName,
    contentType: row.contentType,
    bytes: row.bytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: API_ERROR_CODES.NOT_FOUND, message });
}

/**
 * The recording a lesson carries.
 *
 * Ownership is answered the same way as the lesson's own routes answer it — through the module
 * the path named, resolved against the courses the session owns, with "not yours" and "not
 * there" given one `NOT_FOUND`. What is new here is only the order: that answer is required
 * before a single byte of the body is read, because an upload is the one write in this API that
 * costs disk, and a stranger would otherwise be able to fill it by guessing ids.
 *
 * The page has to be one the syllabus still shows: a recording attached to a lesson that has
 * been taken out would be unreachable the moment it landed, and the teacher would have paid the
 * upload for nothing.
 */
@Injectable()
export class LessonAssetsService {
  constructor(
    private readonly modules: CourseModulesRepository,
    private readonly lessons: LessonsRepository,
    private readonly assets: LessonAssetsRepository,
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  /**
   * The bytes land before the row is filed, and the row is what makes them standing. A write
   * that fails halfway is undone by the store; a row that was never filed names nothing, so
   * there is no moment where a lesson points at a video that is not there.
   *
   * `source` is the raw request rather than a parsed body because there is no parsed body: the
   * multipart stream is the payload, and it can only be read once, here.
   */
  async attach(
    teacherUserId: string,
    moduleId: string,
    lessonId: string,
    source: { req: Request; res: Response },
  ): Promise<LessonAsset> {
    const lesson = await this.writableLesson(teacherUserId, moduleId, lessonId);

    const upload = await readLessonVideo(source.req, source.res, {
      lessonId: lesson.id,
      storage: this.storage,
      maxUploadMb: this.env.MAX_UPLOAD_MB,
    });

    const row = await this.assets.replaceStanding({
      lessonId: lesson.id,
      displayName: upload.displayName,
      storedKey: upload.key,
      contentType: upload.contentType,
      bytes: upload.bytes,
    });
    return toAsset(row);
  }

  async standing(
    teacherUserId: string,
    moduleId: string,
    lessonId: string,
  ): Promise<LessonAsset | null> {
    const lesson = await this.writableLesson(teacherUserId, moduleId, lessonId);
    const row = await this.assets.findStanding(lesson.id);
    return row ? toAsset(row) : null;
  }

  /**
   * Play the page's recording back to the teacher who uploaded it.
   *
   * The gate is the one the rest of this service uses — the module resolved against the courses
   * this session owns, and "not yours" answered as "not there" — and everything after it is the
   * shared ranged reader: the same window arithmetic, the same headers, the same door a student
   * goes through. That is the point of it being one function rather than a second implementation
   * here. Two routes, one way to the bytes, because a second reader is a second place for the
   * gate to be wrong.
   */
  async play(
    teacherUserId: string,
    moduleId: string,
    lessonId: string,
    source: { req: Request; res: Response },
  ): Promise<void> {
    const lesson = await this.writableLesson(teacherUserId, moduleId, lessonId);
    const asset = await this.assets.findStanding(lesson.id);
    if (!asset) throw missingRecording();

    await streamLessonVideo(
      {
        contentType: asset.contentType,
        bytes: asset.bytes,
        open: (window) => this.storage.open(asset.storedKey, window),
      },
      source.req,
      source.res,
    );
  }

  /** The page, proved reachable by this session and still in the syllabus. A page taken out of
   * it is `isActive: false`, which `findInModule` already answers as 404 — the same answer a
   * lesson that never was gets, so nothing here leaks which retired pages exist. */
  private async writableLesson(teacherUserId: string, moduleId: string, lessonId: string) {
    const module = await this.ownedModule(teacherUserId, moduleId);
    const lesson = UUID.test(lessonId)
      ? await this.lessons.findInModule(module.id, lessonId)
      : null;
    if (!lesson) throw notFound('We cannot find that lesson.');
    return lesson;
  }

  private async ownedModule(teacherUserId: string, moduleId: string) {
    const module = UUID.test(moduleId)
      ? await this.modules.findOwned(teacherUserId, moduleId)
      : null;
    if (!module) throw notFound('We cannot find that module.');
    return module;
  }
}
