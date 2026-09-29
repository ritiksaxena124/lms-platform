import type {
  AccountStatusCode,
  OpsAccountDetail,
  OpsAccountListResponse,
  RoleCode,
} from '@lms/shared';

import { apiJson } from './api';

/**
 * The accounts desk: one read and the two writes that are the reason the ops role exists.
 *
 * The read carries an email address, which is the only place in this platform allowed to (8a): an
 * operator searching for a person is searching for the address they were given. The ledger beside it
 * deliberately does not, and a screen must not confuse the two tables it is reading.
 *
 * Both writes return the whole account rather than a confirmation, and the screen takes the row's new
 * labels from that answer instead of from what it asked for. The API is allowed to have moved something
 * the operator did not name — a lookup label renamed on the ops screen, a second write that landed
 * first — and a row that reads as the request wished rather than as the response said is a lie with
 * a green tick on it.
 */
export interface AccountFilters {
  q?: string;
  role?: RoleCode;
  page?: number;
}

const PAGE_SIZE = 25;

export async function listAccounts(filters: AccountFilters = {}): Promise<OpsAccountListResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.role) params.set('role', filters.role);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(PAGE_SIZE));

  return apiJson<OpsAccountListResponse>(`/users?${params.toString()}`);
}

export async function setAccountStatus(
  id: string,
  status: AccountStatusCode,
): Promise<OpsAccountDetail> {
  const response = await apiJson<{ account: OpsAccountDetail }>(
    `/users/${encodeURIComponent(id)}/status`,
    { method: 'PATCH', body: { status } },
  );
  return response.account;
}

export async function setAccountRole(id: string, role: RoleCode): Promise<OpsAccountDetail> {
  const response = await apiJson<{ account: OpsAccountDetail }>(
    `/users/${encodeURIComponent(id)}/role`,
    { method: 'PATCH', body: { role } },
  );
  return response.account;
}
