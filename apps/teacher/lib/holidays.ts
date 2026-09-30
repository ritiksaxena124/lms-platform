import type { Holiday, HolidayInput, HolidayListResponse, HolidayResponse } from '@lms/shared';

import { apiJson } from './api';

/**
 * The days a teacher does not teach.
 *
 * Owned by the account because a holiday is personal — Diwali falls on the same date for every
 * teacher, but whether it stops classes is the teacher's decision. Retirement is its own endpoint.
 */

const path = (id?: string): string =>
  id === undefined ? '/availability/holidays' : `/availability/holidays/${encodeURIComponent(id)}`;

export async function listHolidays(): Promise<Holiday[]> {
  const { items } = await apiJson<HolidayListResponse>(path());
  return items;
}

export async function addHoliday(input: HolidayInput): Promise<Holiday> {
  const { holiday } = await apiJson<HolidayResponse>(path(), {
    method: 'POST',
    body: input,
  });
  return holiday;
}

export async function updateHoliday(
  id: string,
  input: Partial<HolidayInput>,
): Promise<Holiday> {
  const { holiday } = await apiJson<HolidayResponse>(path(id), {
    method: 'PATCH',
    body: input,
  });
  return holiday;
}

export async function retireHoliday(id: string): Promise<Holiday> {
  const { holiday } = await apiJson<HolidayResponse>(`${path(id)}/retire`, {
    method: 'POST',
  });
  return holiday;
}
