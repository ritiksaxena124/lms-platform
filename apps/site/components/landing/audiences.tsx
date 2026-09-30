import { cn } from '@lms/ui';

/**
 * Two-column audience section. Splits the value for teachers and learners so
 * each persona sees themselves immediately, with concrete feature lists instead
 * of marketing fluff.
 */

const TEACHER_FEATURES = [
  'Courses built from blocks, pages, and recordings — attached to the page they belong to',
  'A calendar drawn in your own timezone, with only the minutes you open available',
  'Requests that show who is asking and what they are booking',
  'A room that opens when the class starts, not before',
  'An audit trail of every decision, readable from the ops desk',
] as const;

const LEARNER_FEATURES = [
  'A shelf of courses with what each one costs, visible before sign-up',
  'A free page of every paid course — played, not described',
  "Minutes that are actually open, shown in the learner's own clock",
  'Email before the class with the room link, and a confirmation after',
  'One-to-one and small-group formats, both booked the same way',
] as const;

export function Audiences() {
  return (
    <section aria-label="Who Hourloom is for" className="border-y border-line bg-surface">
      <div className="mx-auto grid max-w-page gap-0 px-5 py-16 lg:grid-cols-2 lg:px-8 lg:py-24">
        <AudienceColumn
          eyebrow="For teachers"
          title="Your course, your calendar, your answers"
          description="Independent teachers, tutors, and coaching professionals who already know the subject. You write the syllabus once. The minutes you open decide what a stranger can ask for, and the answer stays yours."
          features={TEACHER_FEATURES}
          tone="brand"
        />

        <AudienceColumn
          eyebrow="For learners"
          title="Read before you book, book what's real"
          description="Learners, and the parents who arrange for them: somebody who wants a topic explained by a person who teaches it for a living, at a time that fits the rest of the day."
          features={LEARNER_FEATURES}
          tone="brand"
          className="lg:border-l lg:border-line lg:pl-10"
        />
      </div>
    </section>
  );
}

function AudienceColumn({
  eyebrow,
  title,
  description,
  features,
  tone,
  className,
}: {
  eyebrow: string;
  title: string;
  description: string;
  features: readonly string[];
  tone: 'brand';
  className?: string;
}) {
  return (
    <div className={cn('py-4 lg:py-0 lg:pr-10', className)}>
      <p className="text-eyebrow uppercase text-brand">{eyebrow}</p>
      <h2 className="mt-2 text-h1 text-ink-strong">{title}</h2>
      <p className="mt-4 max-w-reading text-label leading-relaxed text-ink-muted">{description}</p>
      <ul className="mt-6 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex gap-3 text-label leading-relaxed text-ink">
            <span
              aria-hidden="true"
              className={cn(
                'mt-[0.45rem] size-1.5 shrink-0 rounded-pill',
                tone === 'brand' ? 'bg-ember' : 'bg-ink-faint',
              )}
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
