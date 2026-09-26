'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Illo,
  Select,
  SkeletonGroup,
  StatusPill,
  Textarea,
  TextField,
  notify,
  type StatusTone,
} from '@lms/ui';
import type { Course, CourseModule, Lesson } from '@lms/shared';

import { describeFailure, fieldErrors } from '@/lib/api';
import { readCourse } from '@/lib/courses';
import { listModules } from '@/lib/course-modules';
import {
  createLesson,
  deactivateLesson,
  listLessons,
  publishLesson,
  reorderLessons,
  unpublishLesson,
  updateLesson,
} from '@/lib/lessons';

const STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  published: 'success',
};

/** What an open edit holds, ready to send whole: an emptied box says "clear this", not "keep it". */
interface EditValues {
  title: string;
  body: string;
  /** The text in the box. Empty means the teacher wants no estimate, which is a `null`, not an
   * absent field — the API keeps a number it was not asked to change. */
  estimatedMinutes: string;
  /** Sent on every save rather than only when it changes, because a box the teacher cleared has
   * to arrive as `false` — leaving it out would keep the page open. */
  isFreePreview: boolean;
}

function valuesOf(lesson: Lesson): EditValues {
  return {
    title: lesson.title,
    body: lesson.body ?? '',
    estimatedMinutes: lesson.estimatedMinutes === null ? '' : String(lesson.estimatedMinutes),
    isFreePreview: lesson.isFreePreview,
  };
}

/** Which request is in flight. A lesson id, `new` for the add box, or nothing. */
type Busy = string | 'new' | null;

/**
 * The pages inside one module: what is written, in what order, and whether a student can read it.
 *
 * The API owns every number here, as it does on the syllabus — a create is answered with the slot
 * it chose, a move sends the whole order and repaints from the reply. What this screen adds is a
 * second gate to show honestly: a lesson has its own published flag, so a page that is ready is
 * still invisible until the course is published, and the pill says what the *lesson* is while the
 * line at the top says what the *course* is.
 *
 * Nothing is painted optimistically. A publish the API refused leaves a draft on screen, because
 * the row that moved would be a promise about a student's reading nobody made.
 */
export function ModuleLessons({ courseId, moduleId }: { courseId: string; moduleId: string }) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [editing, setEditing] = useState<{ id: string; values: EditValues } | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});

  // The course and the syllabus travel with the pages because both are read here: the course's
  // status decides whether removing a lesson will be refused, and the other modules are what a
  // lesson can be moved to. Guessing either would be wrong on a live course.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);

    Promise.all([readCourse(courseId), listModules(courseId), listLessons(moduleId)])
      .then(([loaded, blocks, items]) => {
        if (!alive) return;
        setCourse(loaded);
        setModules(blocks);
        setLessons(items);
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(describeFailure(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [courseId, moduleId, attempt]);

  const here = modules.find((item) => item.id === moduleId) ?? null;
  const live = course?.status.code === 'published';
  const others = modules.filter((item) => item.id !== moduleId);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (busy || title === '') return;

    setBusy('new');
    setFields({});
    try {
      // A title only: the page is written after the row exists, so the slot it lands in comes
      // from the API rather than from a form that has to guess the length of the syllabus.
      const created = await createLesson(moduleId, { title });
      setLessons((current) => [...current, created]);
      setNewTitle('');
      notify.success(`Lesson ${created.position}`);
    } catch (error) {
      const perField = fieldErrors(error);
      setFields(perField);
      if (Object.keys(perField).length === 0) notify.error(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(lesson: Lesson) {
    if (busy || !editing) return;

    const estimate = editing.values.estimatedMinutes.trim();
    setBusy(lesson.id);
    setFields({});
    try {
      const saved = await updateLesson(moduleId, lesson.id, {
        title: editing.values.title.trim(),
        // An emptied page box is a `''` on the wire, which is what "take the page back to
        // nothing" looks like from a form; the API stores it as no body at all.
        body: editing.values.body.trim(),
        estimatedMinutes: estimate === '' ? null : Number(estimate),
        isFreePreview: editing.values.isFreePreview,
      });
      setLessons((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setEditing(null);
      notify.success('Saved');
    } catch (error) {
      const perField = fieldErrors(error);
      setFields(perField);
      if (Object.keys(perField).length === 0) notify.error(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= lessons.length) return;

    const order = lessons.map((item) => item.id);
    const moving = lessons[index];
    const ahead = lessons[target];
    if (!moving || !ahead) return;

    order[index] = ahead.id;
    order[target] = moving.id;

    setBusy(moving.id);
    try {
      setLessons(await reorderLessons(moduleId, order));
    } catch (error) {
      notify.error(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  /**
   * A request of its own, not part of the edit form.
   *
   * The API treats a body that names a module as a move and ignores every other field in it —
   * which is right, since a page cannot be edited into two places at once. A form that sent the
   * edits and the move together would quietly lose the edits, so this row control sends only the
   * module, and the lesson leaves the list because it is no longer this module's page.
   */
  async function moveToModule(lesson: Lesson, targetModuleId: string) {
    if (busy || targetModuleId === '') return;

    setBusy(lesson.id);
    try {
      const moved = await updateLesson(moduleId, lesson.id, { moduleId: targetModuleId });
      setLessons((current) => current.filter((item) => item.id !== moved.id));
      const into = others.find((item) => item.id === targetModuleId);
      notify.success(into ? `Moved to ${into.title}` : 'Moved');
    } catch (error) {
      notify.error(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  async function transition(lesson: Lesson, action: 'publish' | 'unpublish') {
    if (busy) return;

    setBusy(lesson.id);
    try {
      const changed =
        action === 'publish'
          ? await publishLesson(moduleId, lesson.id)
          : await unpublishLesson(moduleId, lesson.id);
      setLessons((current) => current.map((item) => (item.id === changed.id ? changed : item)));
    } catch (error) {
      // A refused publish comes back keyed to the body, and the row's page box is closed — so
      // the message has to travel with the toast rather than sit in a field nobody can see.
      const perField = fieldErrors(error);
      const reason = perField.body?.[0] ?? perField.title?.[0];
      notify.error(reason ?? describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  async function remove(lesson: Lesson) {
    if (busy) return;

    setBusy(lesson.id);
    try {
      await deactivateLesson(moduleId, lesson.id);
      setLessons((current) => current.filter((item) => item.id !== lesson.id));
      notify.success('Taken out of the module');
    } catch (error) {
      notify.error(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <SkeletonGroup
        rows={3}
        rowClassName="h-16 w-full rounded-card"
        label="Loading the lessons"
      />
    );
  }

  if (loadError) {
    return (
      <ErrorState
        title="The lessons did not load"
        message={loadError}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-h2 text-ink-strong">{here?.title ?? 'Lessons'}</h2>
          {course ? (
            // The course's flag in words, not only in a pill: two flags on one screen is exactly
            // where a colour-coded chip stops carrying enough meaning.
            <span className="text-[0.8125rem] text-ink-muted">
              course {course.status.label.toLowerCase()}
            </span>
          ) : null}
        </div>
        <Link
          href={`/courses/${courseId}/modules`}
          transitionTypes={['nav-back']}
          className="text-[0.8125rem] text-brand underline-offset-4 hover:underline"
        >
          Syllabus
        </Link>
      </div>

      {live ? (
        <p className="text-[0.8125rem] leading-snug text-ink-muted">
          A course a student can read is still a syllabus you can grow: writing, ordering and
          publishing pages all work here, and so does taking out one that is still a draft. A
          published page is the one that has to go back to a draft first — unpublishing is what
          does that.
        </p>
      ) : null}

      {lessons.length === 0 ? (
        <EmptyState
          illustration={<Illo src="/illustrations/peep-standing-11.svg" size="lg" />}
          title="No lessons yet"
          description="A lesson is one page a student opens — the writing itself, with a rough idea of how long it takes. Add the first one below, then write the page."
        />
      ) : (
        <ol aria-label="Lessons" className="flex flex-col gap-3">
          {lessons.map((lesson, index) => {
            const open = editing?.id === lesson.id;
            const rowBusy = busy === lesson.id;
            const published = lesson.status.code === 'published';

            return (
              <li
                key={lesson.id}
                className="rounded-card border border-line bg-surface p-4 sm:p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-field bg-paper-sunk text-[0.8125rem] font-semibold text-ink-muted">
                    {lesson.position}
                  </span>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-h3 text-ink-strong">{lesson.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusPill tone={STATUS_TONE[lesson.status.code] ?? 'neutral'}>
                        {lesson.status.label}
                      </StatusPill>
                      <span className="text-[0.8125rem] text-ink-faint">
                        {lesson.estimatedMinutes === null
                          ? 'No time given'
                          : `About ${lesson.estimatedMinutes} min`}
                      </span>
                      {lesson.isFreePreview ? (
                        // Two tenses, because the teacher has made one decision and the API
                        // needs two: the mark is theirs, the door also belongs to the page's
                        // own status and the course's.
                        <span
                          className={
                            published
                              ? 'text-[0.8125rem] font-medium text-brand'
                              : 'text-[0.8125rem] text-ink-faint'
                          }
                        >
                          {published ? 'Free to read' : 'Free when published'}
                        </span>
                      ) : null}
                    </div>
                    <p
                      className={
                        lesson.body
                          ? 'mt-2 line-clamp-2 text-[0.8125rem] leading-snug text-ink-muted'
                          : 'mt-2 text-[0.8125rem] leading-snug text-ink-faint italic'
                      }
                    >
                      {lesson.body ?? 'Nothing written yet.'}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {index > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${lesson.title} up`}
                        disabled={busy !== null}
                        loading={rowBusy}
                        onClick={() => void move(index, -1)}
                      >
                        Up
                      </Button>
                    ) : null}
                    {index < lessons.length - 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${lesson.title} down`}
                        disabled={busy !== null}
                        loading={rowBusy}
                        onClick={() => void move(index, 1)}
                      >
                        Down
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-label={`Edit ${lesson.title}`}
                      disabled={busy !== null || open}
                      onClick={() => {
                        setFields({});
                        setEditing({ id: lesson.id, values: valuesOf(lesson) });
                      }}
                    >
                      Edit
                    </Button>
                    {published ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Unpublish ${lesson.title}`}
                        disabled={busy !== null}
                        loading={rowBusy}
                        onClick={() => void transition(lesson, 'unpublish')}
                      >
                        Unpublish
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Publish ${lesson.title}`}
                        disabled={busy !== null}
                        loading={rowBusy}
                        onClick={() => void transition(lesson, 'publish')}
                      >
                        Publish
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${lesson.title}`}
                      disabled={busy !== null}
                      loading={rowBusy}
                      onClick={() => void remove(lesson)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                {open && editing ? (
                  <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
                    <TextField
                      id={`lesson-title-${lesson.id}`}
                      label="Title"
                      value={editing.values.title}
                      onChange={(event) =>
                        setEditing((current) =>
                          current
                            ? {
                                ...current,
                                values: { ...current.values, title: event.target.value },
                              }
                            : current,
                        )
                      }
                      error={fields.title}
                      disabled={rowBusy}
                      required
                    />
                    <Textarea
                      id={`lesson-body-${lesson.id}`}
                      label="The page"
                      rows={12}
                      maxLength={20_000}
                      hint="Markdown as it reads. A lesson cannot be published while this is empty."
                      value={editing.values.body}
                      onChange={(event) =>
                        setEditing((current) =>
                          current
                            ? { ...current, values: { ...current.values, body: event.target.value } }
                            : current,
                        )
                      }
                      error={fields.body}
                      disabled={rowBusy}
                      className="font-mono text-[0.875rem]"
                    />
                    <TextField
                      id={`lesson-estimate-${lesson.id}`}
                      label="Estimated minutes"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={600}
                      step={1}
                      hint="Shown to the student as a rough idea. Nothing is timed against it."
                      value={editing.values.estimatedMinutes}
                      onChange={(event) =>
                        setEditing((current) =>
                          current
                            ? {
                                ...current,
                                values: {
                                  ...current.values,
                                  estimatedMinutes: event.target.value,
                                },
                              }
                            : current,
                        )
                      }
                      error={fields.estimatedMinutes}
                      disabled={rowBusy}
                      containerClassName="max-w-48"
                    />
                    <Checkbox
                      id={`lesson-free-${lesson.id}`}
                      label="Free to read"
                      hint="A stranger may open this page without enrolling — once the page and the course are both published. Until then it is a plan, and the row says so."
                      checked={editing.values.isFreePreview}
                      onChange={(event) =>
                        setEditing((current) =>
                          current
                            ? {
                                ...current,
                                values: { ...current.values, isFreePreview: event.target.checked },
                              }
                            : current,
                        )
                      }
                      error={fields.isFreePreview}
                      disabled={rowBusy}
                    />
                    <div className="flex items-center gap-2">
                      <Button type="button" loading={rowBusy} onClick={() => void saveEdit(lesson)}>
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={rowBusy}
                        onClick={() => {
                          setEditing(null);
                          setFields({});
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                {others.length > 0 ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <Select
                      id={`lesson-move-${lesson.id}`}
                      label={`Move ${lesson.title} to another module`}
                      placeholder="Stay in this module"
                      options={others.map((item) => ({ value: item.id, label: item.title }))}
                      value=""
                      disabled={busy !== null}
                      onChange={(event) => {
                        const into = event.target.value;
                        if (into !== '') void moveToModule(lesson, into);
                      }}
                      containerClassName="max-w-72"
                    />
                    <p className="mt-1 text-[0.8125rem] leading-snug text-ink-faint">
                      A moved page joins the end of the module it arrives in.
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <form
        onSubmit={(event) => void add(event)}
        noValidate
        className="rounded-card border border-line bg-surface p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-52 flex-1">
            <TextField
              id="new-lesson"
              label="New lesson"
              hint="One page of reading, 3 to 120 characters to start. Write the page once it has a row."
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              error={fields.title}
              disabled={busy !== null}
            />
          </div>
          <Button type="submit" className="mt-6" loading={busy === 'new'} disabled={busy !== null}>
            Add lesson
          </Button>
        </div>
      </form>
    </div>
  );
}
