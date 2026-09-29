import type { ActionListResponse, ActionSectionCode } from '@lms/shared';

import { apiJson } from './api';

/**
 * The one call the ledger screen makes.
 *
 * The filters travel as the API named them (`section`, `page`, `pageSize`) because the route already
 * validates them against `@lms/shared`, and a client that renamed half of them would be a second
 * vocabulary for one query string — the thing this file exists to avoid.
 *
 * There is no write here, and that is the screen's whole design: an operator reads the ledger and
 * acts on the account or the class the row points at, in that other screen. A log you can edit from
 * the same page you read it on is a log nobody can trust.
 */
export interface ActionFilters {
  section?: ActionSectionCode;
  page?: number;
}

const PAGE_SIZE = 25;

export async function listActions(filters: ActionFilters = {}): Promise<ActionListResponse> {
  const params = new URLSearchParams();
  if (filters.section) params.set('section', filters.section);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(PAGE_SIZE));

  return apiJson<ActionListResponse>(`/actions?${params.toString()}`);
}
