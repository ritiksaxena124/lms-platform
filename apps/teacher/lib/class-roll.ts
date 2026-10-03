import type { ClassRoll, SaveRollInput } from '@lms/shared';

import { apiJson } from './api';

/**
 * One dated class's register, across the wire.
 *
 * The address is the class, so a roll is one class at a time and there is no cross-day screen to
 * keep in step. `classId` is quoted because it travels inside a path: an id that did not belong to
 * the caller would be a way to reach a route the portal never meant to call.
 *
 * The read carries `canMark`, and the write does not take a client's opinion about it. Whether the
 * class has started is the server's clock; a screen that decided for itself would put a save button
 * on a lesson that has not happened yet, and the route would refuse the press.
 */
const path = (classId: string): string => `/classes/${encodeURIComponent(classId)}/roll`;

export async function myClassRoll(classId: string): Promise<ClassRoll> {
  return apiJson<ClassRoll>(path(classId));
}

/**
 * The marks, sent as a whole sheet.
 *
 * The response is the roll re-read after the write, so the caller renders the table's answer rather
 * than the one it typed — which is also how a line the body did not mention stays exactly as it was.
 */
export async function saveClassRoll(classId: string, input: SaveRollInput): Promise<ClassRoll> {
  return apiJson<ClassRoll>(path(classId), { method: 'PUT', body: input });
}
