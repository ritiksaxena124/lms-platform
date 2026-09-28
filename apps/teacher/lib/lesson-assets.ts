import type { AttachLessonAssetResponse, LessonAsset, LessonAssetResponse } from '@lms/shared';

import { apiBytes, apiForm, apiJson } from './api';

/**
 * The three calls a recording needs: what stands on the page, a file going up, bytes coming back.
 *
 * Nothing here builds an address for the file. There is none to build — the bytes live under a key
 * the store owns and are only ever handed out by the page's own route, after that route has
 * resolved the row and therefore the person (ARCHITECTURE §6). So the portal asks for the bytes
 * and gets a Blob, and the player is shown an object URL made from it.
 */

const pathFor = (moduleId: string, lessonId: string): string =>
  `/modules/${moduleId}/lessons/${lessonId}/asset`;

/** `null` is the ordinary answer for a page nobody has recorded, and the caller draws for it. */
export async function standingLessonAsset(
  moduleId: string,
  lessonId: string,
): Promise<LessonAsset | null> {
  const { asset } = await apiJson<LessonAssetResponse>(pathFor(moduleId, lessonId));
  return asset;
}

/**
 * Attach — or replace, which is the same request.
 *
 * The API files a new row and retires the old one rather than overwriting, so the answer is
 * always the recording now standing, whatever the page carried before.
 */
export async function attachLessonAsset(
  moduleId: string,
  lessonId: string,
  file: File,
): Promise<LessonAsset> {
  const form = new FormData();
  form.append('file', file);
  const { asset } = await apiForm<AttachLessonAssetResponse>(pathFor(moduleId, lessonId), form);
  return asset;
}

/** The whole recording, for a player that cannot send a bearer header of its own. */
export function lessonAssetBytes(moduleId: string, lessonId: string): Promise<Blob> {
  return apiBytes(`${pathFor(moduleId, lessonId)}/video`);
}
