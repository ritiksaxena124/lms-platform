import type {
  AvailabilityRule,
  AvailabilityRuleInput,
  AvailabilityRuleListResponse,
  AvailabilityRuleResponse,
} from '@lms/shared';

import { apiJson } from './api';

/**
 * The teacher's own week, across the wire.
 *
 * There is no teacher in any of these calls: the session is the teacher, and a client that could
 * name somebody else would be a way to write a colleague's week in their absence. The address is
 * not nested under a course either — a window is a shape the teacher's week has, and the courses
 * that later cut slots from it are a different question (§13).
 *
 * Closing a window goes through its own route rather than a `isActive: false` on a move, because
 * retirement is a decision with a state attached to it, and an edit that could also clear a flag
 * would be a way to close a window while pretending to re-time it.
 */

const path = (id?: string): string =>
  id === undefined ? '/availability/rules' : `/availability/rules/${encodeURIComponent(id)}`;

export async function listWindows(): Promise<AvailabilityRule[]> {
  const { items } = await apiJson<AvailabilityRuleListResponse>(path());
  return items;
}

export async function openWindow(input: AvailabilityRuleInput): Promise<AvailabilityRule> {
  const { rule } = await apiJson<AvailabilityRuleResponse>(path(), {
    method: 'POST',
    body: input,
  });
  return rule;
}

/** Only the fields the teacher actually moved. A body that named all four would be a way to
 * overwrite a window another tab changed a second ago, under the guise of editing one number. */
export async function moveWindow(
  id: string,
  input: Partial<AvailabilityRuleInput>,
): Promise<AvailabilityRule> {
  const { rule } = await apiJson<AvailabilityRuleResponse>(path(id), {
    method: 'PATCH',
    body: input,
  });
  return rule;
}

export async function closeWindow(id: string): Promise<AvailabilityRule> {
  const { rule } = await apiJson<AvailabilityRuleResponse>(`${path(id)}/retire`, {
    method: 'POST',
  });
  return rule;
}
