'use client';

import { useState } from 'react';

import { cn } from '@lms/ui';

/**
 * Accordion FAQ based on real questions a teacher or learner would ask about
 * Hourloom. Uses native HTML details/summary for accessibility and keyboard
 * support, with CSS transitions for smooth open/close.
 */

const QUESTIONS = [
  {
    q: 'What is Hourloom?',
    a: 'Hourloom is a platform for independent teachers to run 1:1 and small-group classes. A teacher writes a course, opens the hours they teach, and learners book time directly. The platform handles the course pages, the booking, the room, and the email — and keeps a record of every decision.',
  },
  {
    q: 'Who is Hourloom for?',
    a: 'Independent teachers, tutors, and coaching professionals who know their subject and want a clean way to schedule and run classes. And learners — or the parents arranging for them — who want to find a teacher, read the course, and book a real time slot.',
  },
  {
    q: 'Is it free?',
    a: 'Yes, right now. Hourloom is free to use while we build. Courses display a listed fee, but no charge is processed yet. Payments are the next thing being built. Nothing here pretends to charge you.',
  },
  {
    q: 'Do I need technical knowledge?',
    a: 'No. If you can write in a text editor and drag on a calendar, you can use Hourloom. The teacher portal walks you through creating a course and opening your availability.',
  },
  {
    q: 'How does booking work?',
    a: 'A learner browses a course, picks a time that the teacher has marked as open, and sends a request. The teacher sees who is asking and what they want to book, then accepts or declines. If accepted, both get an email with a room link that opens at the class time.',
  },
  {
    q: 'What happens during a class?',
    a: 'A room opens at the booked time — not a minute before. Both the teacher and the learner join through the link in their email. After the class, both receive a confirmation.',
  },
  {
    q: 'Can I see a course before booking?',
    a: 'Yes. Every paid course has at least one free page. You can read it and watch the recording before deciding to take a place.',
  },
  {
    q: 'What data does Hourloom keep?',
    a: 'Every decision — every booking request, every acceptance, every class — leaves a record. The ops desk can read it back. This is an audit trail, not analytics: it records what happened, not what you clicked.',
  },
] as const;

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section aria-labelledby="faq" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-page px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-[720px]">
          <h2
            id="faq"
            className="text-center text-[1.75rem] font-semibold leading-tight tracking-[-0.011em] text-ink-strong sm:text-[2rem]"
          >
            Questions & answers
          </h2>
          <p className="mx-auto mt-4 max-w-reading text-center text-h3 leading-relaxed text-ink-muted">
            What a teacher or learner would ask before signing up.
          </p>

          <div className="mt-12 divide-y divide-line">
            {QUESTIONS.map((item, i) => (
              <FaqItem
                key={item.q}
                question={item.q}
                answer={item.a}
                isOpen={openIndex === i}
                onToggle={() => setOpenIndex(openIndex === i ? null : i)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FaqItem({
  question,
  answer,
  isOpen,
  onToggle,
}: {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="py-5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-start justify-between gap-4 text-left"
      >
        <span className="text-label font-semibold text-ink-strong">{question}</span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            'mt-0.5 size-4 shrink-0 text-ink-muted transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)]',
            isOpen && 'rotate-180',
          )}
          aria-hidden="true"
        >
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-[var(--duration-base)] ease-[var(--ease-out)]',
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <p className="pt-3 text-label leading-relaxed text-ink-muted">{answer}</p>
        </div>
      </div>
    </div>
  );
}
