import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { RoleCode } from '@lms/shared';

export const REQUIRED_ROLES = 'lms:required-roles';

/**
 * Restricts a route to the given roles. Purely declarative — the check happens in
 * `RolesGuard`, which compares against the account as it is in the database *now*, so a
 * promotion or a demotion takes effect without waiting for a token to expire.
 *
 * With no `@Roles()` a signed-in account of any role is enough. Elevation is the thing worth
 * declaring; ordinary access is already established by the guard that ran before this one.
 */
export function Roles(...codes: RoleCode[]): CustomDecorator<string> {
  return SetMetadata(REQUIRED_ROLES, codes);
}
