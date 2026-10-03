import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { PermissionCode } from '@lms/shared';

export const REQUIRED_PERMISSIONS = 'lms:required-permissions';

/**
 * Names what a caller has to be able to do. Purely declarative — the check happens in
 * `PermissionsGuard`, which reads the account's role from the database as it is *now* and asks the
 * matrix for that role's capabilities, so a promotion or a demotion takes effect without waiting for
 * a token to expire.
 *
 * Several codes are a conjunction: a route that says `course.author` and `media.upload` wants an
 * account holding both. With no `@Permissions()` a signed-in account of any role is enough, because
 * elevation is the thing worth declaring and ordinary access was established by the guard before it.
 *
 * A route states a capability rather than a role on purpose. Three roles exist today and each
 * holds a fixed bundle, so the two wordings answer the same question this week — only one of them
 * stays true when somebody adds a fourth kind of account, and the reference can print what an
 * address actually asks for.
 */
export function Permissions(...codes: PermissionCode[]): CustomDecorator<string> {
  return SetMetadata(REQUIRED_PERMISSIONS, codes);
}
