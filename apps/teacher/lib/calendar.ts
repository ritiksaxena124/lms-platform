import type { ClassSeries, ClassSeriesInput, ClassSeriesListResponse, ClassSeriesResponse } from '@lms/shared';

import { apiJson } from './api';

/**
 * The recurring weekly slots a teacher schedules for one course.
 *
 * Series are owned by the course — a teacher schedules one course's rhythm separately from another's.
 * Retirement is its own endpoint so an edit cannot smuggle in a flag change beside new times.
 */

const seriesPath = (courseId: string, id?: string): string =>
  id === undefined
    ? `/courses/${encodeURIComponent(courseId)}/series`
    : `/courses/${encodeURIComponent(courseId)}/series/${encodeURIComponent(id)}`;

export async function listSeries(courseId: string): Promise<ClassSeries[]> {
  const { items } = await apiJson<ClassSeriesListResponse>(seriesPath(courseId));
  return items;
}

export async function addSeries(
  courseId: string,
  input: ClassSeriesInput,
): Promise<ClassSeries> {
  const { series } = await apiJson<ClassSeriesResponse>(seriesPath(courseId), {
    method: 'POST',
    body: input,
  });
  return series;
}

export async function updateSeries(
  courseId: string,
  id: string,
  input: Partial<ClassSeriesInput>,
): Promise<ClassSeries> {
  const { series } = await apiJson<ClassSeriesResponse>(seriesPath(courseId, id), {
    method: 'PATCH',
    body: input,
  });
  return series;
}

export async function retireSeries(courseId: string, id: string): Promise<ClassSeries> {
  const { series } = await apiJson<ClassSeriesResponse>(`${seriesPath(courseId, id)}/retire`, {
    method: 'POST',
  });
  return series;
}
