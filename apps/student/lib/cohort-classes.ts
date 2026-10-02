import type { AssignedClass, LearningClassesResponse } from '@lms/shared';

import { apiGet } from './api';

/**
 * The classes this student is standing for because a course they hold a place in put them there.
 *
 * A second read beside the bookings, and it has to stay separate: both are one person's calendar,
 * but they come from two different decisions — this student pressed something on one list, and a
 * teacher's plan wrote the other. A booking has a way out and a live door; a scheduled class has
 * neither, because there is no route that would accept a student quitting their own cohort. The
 * screen that draws them together is the only place allowed to pretend they are one kind of row.
 *
 * No window is asked for, so nothing here can drift from the horizon the sweep itself keeps, and no
 * screen has to know what a `ScheduledClass` is in order to page across a month.
 */
export async function myAssignedClasses(): Promise<AssignedClass[]> {
  const response = await apiGet<LearningClassesResponse>('/classes/learning', '', {
    withSession: true,
  });
  return response.items;
}
