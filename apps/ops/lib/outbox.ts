import type { MailOutboxStatusCode, OutboxListResponse } from '@lms/shared';

import { apiJson } from './api';

/**
 * The queue, as one question at a time.
 *
 * The route answers two filters, and this file offers one of them. `recipient` is the other, and it
 * arrives as an id — an operator who means a specific person has already found them on the accounts
 * desk, so the filter belongs to a link from that row rather than to a box where a uuid gets typed.
 *
 * There is no write here either, and there is nothing to write. A row that reached `failed` has run
 * out of the retry curve the sweep obeys; resending it from a screen would be a second program for
 * the same row, and the person it is addressed to would get the letter twice.
 */
export interface OutboxFilters {
  status?: MailOutboxStatusCode;
  page?: number;
}

const PAGE_SIZE = 25;

export async function listOutbox(filters: OutboxFilters = {}): Promise<OutboxListResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(PAGE_SIZE));

  return apiJson<OutboxListResponse>(`/outbox?${params.toString()}`);
}
