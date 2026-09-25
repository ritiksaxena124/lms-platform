'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import {
  Button,
  EmptyState,
  ErrorState,
  Illo,
  SkeletonGroup,
  StatusPill,
  Textarea,
  TextField,
  notify,
  type StatusTone,
} from '@lms/ui';
import type { Course, CourseModule } from '@lms/shared';

import { describeFailure, fieldErrors } from '@/lib/api';
import { readCourse } from '@/lib/courses';
import {
  createModule,
  deactivateModule,
  listModules,
  reorderModules,
  updateModule,
} from '@/lib/course-modules';

const STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  published: 'success',
  archived: 'warning',
};

/** What an open edit holds, ready to send whole: an emptied box says "clear this", not "keep it". */
interface EditValues {
  title: string;
  summary: string;
  description: string;
}

function valuesOf(module: CourseModule): EditValues {
  return {
    title: module.title,
    summary: module.summary ?? '',
    description: module.description ?? '',
  };
}

/** Which request is in flight. A module id, `new` for the add box, or nothing. */
type Busy = string | 'new' | null;

/**
 * The syllabus of one course: what a module is, in what order, and what happens to it.
 *
 * The API owns every number on this screen. A create is answered with the slot it chose, a
 * move sends the whole order and repaints from the reply, and a rename leaves the position
 * alone because the endpoint it hits has no position to write. Nothing here is optimistic:
 * a row shows what the server confirmed, so a refusal cannot leave a syllabus on screen that
 * does not exist.
 */
export function CourseSyllabus({ courseId }: { courseId: string }) {
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [editing, setEditing] = useState<{ id: string; values: EditValues } | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});

  // The course travels with its syllabus because the status is what decides whether removing
  // a module will be refused, and a screen that guessed would be wrong on a live course.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);

    Promise.all([readCourse(courseId), listModules(courseId)])
      .then(([loaded, items]) => {
        if (!alive) return;
        setCourse(loaded);
        setModules(items);
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
  }, [courseId, attempt]);

  const live = course?.status.code === 'published';

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (busy || title === '') return;

    setBusy('new');
    setFields({});
    try {
      const created = await createModule(courseId, { title });
      setModules((current) => [...current, created]);
      setNewTitle('');
      notify.success(`Module ${created.position}`);
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
    if (target < 0 || target >= modules.length) return;

    const order = modules.map((item) => item.id);
    const moving = modules[index];
    const ahead = modules[target];
    if (!moving || !ahead) return;

    order[index] = ahead.id;
    order[target] = moving.id;

    setBusy(moving.id);
    try {
      // The whole order goes, and the whole order comes back: the screen repaints from the
      // slots the API wrote rather than assuming the swap it asked for is the swap it got.
      setModules(await reorderModules(courseId, order));
    } catch (error) {
      notify.error(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(module: CourseModule) {
    if (busy || !editing) return;

    setBusy(module.id);
    setFields({});
    try {
      const saved = await updateModule(courseId, module.id, {
        title: editing.values.title.trim(),
        summary: editing.values.summary.trim(),
        description: editing.values.description.trim(),
      });
      setModules((current) => current.map((item) => (item.id === saved.id ? saved : item)));
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

  async function remove(module: CourseModule) {
    if (busy) return;

    setBusy(module.id);
    try {
      await deactivateModule(courseId, module.id);
      setModules((current) => current.filter((item) => item.id !== module.id));
      notify.success('Taken out of the syllabus');
    } catch (error) {
      // The row stays where it is. A removal the course refused has not happened, and a
      // syllabus that painted it anyway would be a list of promises nothing backs.
      notify.error(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <SkeletonGroup rows={3} rowClassName="h-16 w-full rounded-card" label="Loading the syllabus" />
    );
  }

  if (loadError) {
    return (
      <ErrorState
        title="The syllabus did not load"
        message={loadError}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {course ? (
          <div className="flex items-center gap-2">
            <span className="text-[0.8125rem] text-ink-muted">{course.title}</span>
            <StatusPill tone={STATUS_TONE[course.status.code] ?? 'neutral'}>
              {course.status.label}
            </StatusPill>
          </div>
        ) : null}
        <Link
          href={`/courses/${courseId}/edit`}
          transitionTypes={['nav-back']}
          className="text-[0.8125rem] text-brand underline-offset-4 hover:underline"
        >
          Course details
        </Link>
      </div>

      {live ? (
        <p className="text-[0.8125rem] leading-snug text-ink-muted">
          A course a student can read is still a syllabus you can grow: adding and renaming work
          now. Removing one needs the course archived first.
        </p>
      ) : null}

      {modules.length === 0 ? (
        <EmptyState
          illustration={<Illo src="/illustrations/peep-standing-11.svg" size="lg" />}
          title="No modules yet"
          description="A module is one block of the syllabus — the stretch of the course its lessons sit under. Add the first one below."
        />
      ) : (
        <ol aria-label="Syllabus" className="flex flex-col gap-3">
          {modules.map((module, index) => {
            const open = editing?.id === module.id;
            const rowBusy = busy === module.id;

            return (
              <li
                key={module.id}
                className="rounded-card border border-line bg-surface p-4 sm:p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-field bg-paper-sunk text-[0.8125rem] font-semibold text-ink-muted">
                    {module.position}
                  </span>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-h3 text-ink-strong">{module.title}</h3>
                    {module.summary ? (
                      <p className="mt-1 text-[0.8125rem] leading-snug text-ink-muted">
                        {module.summary}
                      </p>
                    ) : null}
                    {module.description ? (
                      <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-ink-faint">
                        {module.description}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {index > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${module.title} up`}
                        disabled={busy !== null}
                        loading={rowBusy}
                        onClick={() => void move(index, -1)}
                      >
                        Up
                      </Button>
                    ) : null}
                    {index < modules.length - 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${module.title} down`}
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
                      aria-label={`Edit ${module.title}`}
                      disabled={busy !== null || open}
                      onClick={() => {
                        setFields({});
                        setEditing({ id: module.id, values: valuesOf(module) });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${module.title}`}
                      disabled={busy !== null}
                      loading={rowBusy}
                      onClick={() => void remove(module)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                {open && editing ? (
                  <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
                    <TextField
                      id={`module-title-${module.id}`}
                      label="Title"
                      value={editing.values.title}
                      onChange={(event) =>
                        setEditing((current) =>
                          current ? { ...current, values: { ...current.values, title: event.target.value } } : current,
                        )
                      }
                      error={fields.title}
                      disabled={rowBusy}
                      required
                    />
                    <TextField
                      id={`module-summary-${module.id}`}
                      label="Summary"
                      hint="One line under the title, 180 characters or fewer."
                      value={editing.values.summary}
                      onChange={(event) =>
                        setEditing((current) =>
                          current
                            ? { ...current, values: { ...current.values, summary: event.target.value } }
                            : current,
                        )
                      }
                      error={fields.summary}
                      disabled={rowBusy}
                    />
                    <Textarea
                      id={`module-description-${module.id}`}
                      label="Description"
                      rows={5}
                      value={editing.values.description}
                      onChange={(event) =>
                        setEditing((current) =>
                          current
                            ? {
                                ...current,
                                values: { ...current.values, description: event.target.value },
                              }
                            : current,
                        )
                      }
                      error={fields.description}
                      disabled={rowBusy}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        loading={rowBusy}
                        onClick={() => void saveEdit(module)}
                      >
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
              id="new-module"
              label="New module"
              hint="A block of the syllabus, 3 to 120 characters. Its lessons come next."
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              error={fields.title}
              disabled={busy !== null}
            />
          </div>
          <Button type="submit" className="mt-6" loading={busy === 'new'} disabled={busy !== null}>
            Add module
          </Button>
        </div>
      </form>
    </div>
  );
}
