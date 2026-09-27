/**
 * The wire contract for a recording a teacher attached to a lesson.
 *
 * What is deliberately not here is where the bytes live. `storedKey` stays in the database:
 * a client that knew it would be looking for a URL to fetch it from, and this design has
 * none — every read of a recording goes through a route that resolved the row, and therefore
 * the person, first (ARCHITECTURE §6). The same reason the payload carries `bytes` but no
 * stream: it is a description of a file, not access to one.
 */

export interface LessonAsset {
  id: string;
  lessonId: string;
  /** The filename as the teacher sent it, kept for their own page. Display text only — it
   * never chooses a path, and it is allowed to be a duplicate or to make sense to nobody
   * else. */
  displayName: string;
  contentType: string;
  bytes: number;
  createdAt: string;
  updatedAt: string;
}

/** What a page currently has on it. `null` is the ordinary answer for a lesson nobody has
 * recorded, which is why the route that reads state is not the same shape as the one that
 * writes it. */
export interface LessonAssetResponse {
  asset: LessonAsset | null;
}

/** The row a successful upload filed — always the one now standing. */
export interface AttachLessonAssetResponse {
  asset: LessonAsset;
}
