import Link from 'next/link';
import { cn } from '@lms/ui';

/**
 * The screens one course owns, in the order a teacher builds them.
 *
 * A course is not one page: its syllabus, its roster, its weekly series and its discount codes are
 * four separate writes with four separate reasons to visit. Until this strip existed, two of those
 * four could only be reached by typing the address, because the course card had run out of room and
 * each screen knew nothing about its siblings.
 *
 * It is a server component on purpose. Nothing here waits on a session or a fetch — the five links
 * are the whole of the content — so the strip is on screen with the page rather than after a request
 * for it. The active tab is a prop rather than `usePathname`, which would need a client boundary and
 * would still have to be told that a lesson screen belongs to the syllabus.
 */

const SCREENS = [
  { key: 'overview', segment: 'edit', label: 'Overview' },
  { key: 'syllabus', segment: 'modules', label: 'Syllabus' },
  { key: 'roster', segment: 'roster', label: 'Roster' },
  { key: 'series', segment: 'series', label: 'Series' },
  { key: 'coupons', segment: 'coupons', label: 'Coupons' },
] as const;

/** The screens a course card can send a teacher to. The card itself links to the overview through
 * the title, so the row below it carries the rest — in this order, under the same names, so the
 * card and the strip cannot drift into two different ways of saying the same thing. */
export const COURSE_CARD_SCREENS = SCREENS.filter((screen) => screen.key !== 'overview');

export type CourseScreen = (typeof SCREENS)[number]['key'] | 'lessons';

/** The lessons screen sits a level below the syllabus, so it lights the syllabus rather than
 * claiming a tab of its own among the course's own screens. */
const ACTIVE_BY_SCREEN: Record<CourseScreen, CourseScreen> = {
  lessons: 'syllabus',
  overview: 'overview',
  syllabus: 'syllabus',
  roster: 'roster',
  series: 'series',
  coupons: 'coupons',
};

export function CourseNav({
  courseId,
  active,
}: {
  courseId: string;
  active: CourseScreen;
}) {
  const lit = ACTIVE_BY_SCREEN[active];

  return (
    <nav aria-label="Screens in this course" className="mt-5 overflow-x-auto">
      <ul className="flex gap-1 rounded-card bg-paper-sunk p-1">
        {SCREENS.map((screen) => {
          const on = screen.key === lit;

          return (
            <li key={screen.key} className="flex-1">
              <Link
                href={`/courses/${courseId}/${screen.segment}`}
                transitionTypes={['nav-forward']}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'block rounded-field px-3 py-2 text-center text-label',
                  'transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                  on
                    ? 'bg-brand-soft font-semibold text-brand-deep'
                    : 'text-ink-muted hover:bg-surface hover:text-ink',
                )}
              >
                {screen.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
