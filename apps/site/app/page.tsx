import Link from 'next/link';

import { buttonClass, cn, Stagger } from '@lms/ui';

import { readPortalUrls } from '@/lib/portals';

/**
 * The four moves one class makes, in the order they happen.
 *
 * This is the whole product in four lines, so it is the thing a visitor should leave with. Each line
 * names who acts, because the reason a teacher stays is that the answers are theirs to give.
 */
const CLASS_LOOP = [
  {
    actor: 'A teacher',
    line: 'writes the course — the blocks, the pages, the recordings — and opens the evenings they are actually free, in their own clock.',
  },
  {
    actor: 'A learner',
    line: 'reads enough of it to want a place, takes one, and asks for a minute of that teacher’s time.',
  },
  {
    actor: 'The teacher answers',
    line: 'yes, and the class gets a room of its own; no, and the learner hears so. Nobody sits in an empty call waiting.',
  },
  {
    actor: 'Both are told',
    line: 'by email, before the minute and after it — and every one of those decisions leaves a record the platform can be asked about.',
  },
];

const SHIPPED = [
  'Courses with blocks, pages, and a recording attached to the page it belongs to.',
  'A free page of a paid course, so a learner reads before taking a place.',
  'One-to-one and small-group classes, booked out of the minutes a teacher opened.',
  'A room for the class that opens in its window and not a minute before.',
  'Email at every turn of that loop, sent when the decision was made rather than nightly.',
  'A record of who changed what, and a desk that reads it back.',
];

/**
 * What is not built, said next to what is.
 *
 * A course carries a price and nothing is charged; a class is one booked minute rather than a
 * standing weekly slot. Both are coming, and both are the kind of gap a teacher discovers in front of
 * a parent who was promised something this platform cannot yet do.
 */
const NOT_YET = [
  'A price is shown, and no payment is taken. Money is the next thing built here.',
  'One booked minute is a class; a week that repeats itself on its own is not built yet.',
  'A teacher is found by a link someone sent you, not by a search that ranks them.',
];

export default function Home() {
  const portals = readPortalUrls();

  return (
    <>
      <section aria-labelledby="pitch" className="border-b border-line bg-paper-sheen">
        <Stagger className="mx-auto max-w-page px-5 py-16 lg:px-8 lg:py-24">
          <p className="text-eyebrow uppercase text-brand">One teacher, one learner, one room</p>
          <h1
            id="pitch"
            className="mt-3 max-w-reading text-[2.5rem] leading-[1.08] font-semibold tracking-[-0.022em] text-ink-strong sm:text-[3.25rem]"
          >
            The class you teach is the shop you keep
          </h1>
          <p className="mt-5 max-w-reading text-h3 leading-relaxed text-ink-muted">
            A marketplace for 1:1 and small-group classes with independent teachers. A teacher
            writes the course and opens the week they teach; a learner reads it, takes a place, and
            asks for a minute of that time. What both of them get is the part a calendar and a group
            call never handled — the asking, the answering, the room, and the record.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={portals.teacher}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ size: 'lg' })}
            >
              Teacher portal
            </a>
            <a
              href={portals.student}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ variant: 'secondary', size: 'lg' })}
            >
              Student portal
            </a>
            <Link href="/docs" className={buttonClass({ variant: 'ghost', size: 'lg' })}>
              Read the docs
            </Link>
          </div>

          <p className="mt-6 max-w-reading text-label leading-relaxed text-ink-faint">
            Teachers set their own minutes, their own prices and their own answers. Nothing here is
            charged yet, and nothing here is a promise that a stranger will take a payment.
          </p>
        </Stagger>
      </section>

      <section
        aria-labelledby="the-loop"
        className="mx-auto max-w-page px-5 py-16 lg:px-8 lg:py-20"
      >
        <h2 id="the-loop" className="text-h1 text-ink-strong">
          How a class happens
        </h2>

        <ol aria-label="How a class happens" className="mt-8 grid gap-4 sm:grid-cols-2">
          {CLASS_LOOP.map((step) => (
            <li key={step.actor} className="rounded-card border border-line bg-surface px-5 py-6">
              <p className="text-eyebrow uppercase text-brand">{step.actor}</p>
              <p className="mt-2 text-label leading-relaxed text-ink">{step.line}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Who it is for" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-page gap-10 px-5 py-16 lg:grid-cols-2 lg:px-8 lg:py-20">
          <div>
            <h2 className="text-h1 text-ink-strong">For the one teaching</h2>
            <p className="mt-4 max-w-reading text-label leading-relaxed text-ink-muted">
              Independent teachers, tutors and coaching professionals who already know the subject
              and would rather spend the evening on it than on the machinery around it. You write
              the syllabus once. The minutes you open decide what a stranger can ask for, and the
              answer stays yours.
            </p>
            <MarkerList
              tone="brand"
              lines={[
                'Courses, blocks and pages, with a recording attached to the page it belongs to',
                'A week drawn on a calendar, in your own timezone, across a summer that moves',
                'Requests that say who is asking and what they are taking',
                'A room that opens when the class starts and not before',
              ]}
            />
          </div>

          <div className="lg:border-l lg:border-line lg:pl-10">
            <h2 className="text-h1 text-ink-strong">For the one learning</h2>
            <p className="mt-4 max-w-reading text-label leading-relaxed text-ink-muted">
              Learners, and the parents who arrange for them: somebody who wants a topic explained
              by a person who teaches it for a living, at a time that fits the rest of the day. Read
              the course before taking a place, and open a page of it free before deciding.
            </p>
            <MarkerList
              tone="brand"
              lines={[
                'A shelf of courses with what each one costs said on it',
                'A free page of a paid course, played rather than described',
                'Minutes that are actually open, shown in the learner’s own clock',
                'An email before the class, and a room in the same breath',
              ]}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="today" className="mx-auto max-w-page px-5 py-16 lg:px-8 lg:py-20">
        <h2 id="today" className="text-h1 text-ink-strong">
          What works today
        </h2>

        <div className="mt-8 grid gap-10 md:grid-cols-2">
          <div>
            <p className="text-eyebrow uppercase text-success">Built, tested, clickable</p>
            <MarkerList tone="shipped" lines={SHIPPED} />
          </div>

          <div>
            <p className="text-eyebrow uppercase text-warning">Not yet, and said as not yet</p>
            <MarkerList tone="pending" lines={NOT_YET} />
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-page flex-wrap items-baseline gap-x-8 gap-y-3 px-5 py-8 lg:px-8">
          <span className="text-label font-semibold text-ink-strong">Teacher Marketplace</span>
          <span className="text-label text-ink-faint">
            A working proof: one API, three portals, one component library, one database.
          </span>
          <Link
            href="/docs"
            className="ml-auto text-label text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-ink"
          >
            Documentation
          </Link>
        </div>
      </footer>
    </>
  );
}

/**
 * A line with a dot beside it, which is the marker every portal already uses.
 *
 * Not a tick and not a cross: this system draws separation with a line and emphasis with colour, and
 * a green check next to a grey ring would be the first two icons on a page that has no buttons.
 */
function MarkerList({
  lines,
  tone,
}: {
  lines: readonly string[];
  tone: 'brand' | 'shipped' | 'pending';
}) {
  const dot =
    tone === 'pending'
      ? 'border border-line-strong bg-transparent'
      : tone === 'shipped'
        ? 'bg-success'
        : 'bg-ember';

  return (
    <ul className="mt-5 space-y-2.5 text-label leading-relaxed text-ink">
      {lines.map((line) => (
        <li key={line} className="flex gap-2.5">
          <span
            aria-hidden="true"
            className={cn('mt-[0.45rem] size-1.5 shrink-0 rounded-pill', dot)}
          />
          <span className={tone === 'pending' ? 'text-ink-muted' : undefined}>{line}</span>
        </li>
      ))}
    </ul>
  );
}
