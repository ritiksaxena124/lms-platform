export type PortalUrls = { teacher: string; student: string };

/**
 * Where the two doors are, read from the build environment.
 *
 * There is no fallback here, and that is deliberate. ARCHITECTURE.md §6 records what a `localhost`
 * default costs: the app boots happily on the machine that wrote it, and every link it prints is
 * unreachable for the person who clicked it. A build without these two keys fails with a message
 * naming them, which is the only way this page can be trusted to have been built for the address it
 * will be served from.
 *
 * The operator's desk is not in this list. It is a real portal on a real port, and this page is read
 * by strangers — publishing the address of the surface that disables accounts and hands out the `ops`
 * role is a gift to anybody scanning for a login form that belongs to somebody else.
 */
export function readPortalUrls(): PortalUrls {
  const teacher = process.env.NEXT_PUBLIC_TEACHER_PORTAL_URL;
  const student = process.env.NEXT_PUBLIC_STUDENT_PORTAL_URL;

  const missing = [
    [teacher, 'NEXT_PUBLIC_TEACHER_PORTAL_URL'],
    [student, 'NEXT_PUBLIC_STUDENT_PORTAL_URL'],
  ]
    .filter(([value]) => !value)
    .map(([, name]) => name);

  if (missing.length) {
    throw new Error(
      `apps/site cannot build without ${missing.join(' and ')} — copy apps/site/.env.example to ` +
        `apps/site/.env.development for a local run, and set the real addresses for a deployed one.`,
    );
  }

  return { teacher: teacher as string, student: student as string };
}
