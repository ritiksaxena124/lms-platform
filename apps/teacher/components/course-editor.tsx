'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  ErrorState,
  Select,
  Skeleton,
  StatusPill,
  Textarea,
  TextField,
  notify,
  type StatusTone,
} from '@lms/ui';
import type { Course, CourseChoice } from '@lms/shared';

import { describeFailure, fieldErrors } from '@/lib/api';
import {
  archiveCourse,
  courseLevels,
  createCourse,
  publishCourse,
  readCourse,
  updateCourse,
} from '@/lib/courses';

const STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  published: 'success',
  archived: 'warning',
};

/** What the form holds, before anything knows whether it is a new course or an old one. */
interface FormValues {
  title: string;
  slug: string;
  level: string;
  summary: string;
  description: string;
}

const BLANK: FormValues = { title: '', slug: '', level: '', summary: '', description: '' };

function ofCourse(course: Course): FormValues {
  return {
    title: course.title,
    slug: course.slug,
    level: course.level.code,
    summary: course.summary ?? '',
    description: course.description ?? '',
  };
}

/**
 * The one place a course is written.
 *
 * The API owns every rule here, so the form's job is to ask for a thing and show what came
 * back: a new draft goes to the list that now holds it, a rejected publish marks the fields
 * it named, and a published course reads as locked because it *is* locked — the portal does
 * not disable a button the server would refuse anyway, and it does not paint a status the
 * server did not confirm.
 */
export function CourseEditor({ courseId }: { courseId?: string }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(BLANK);
  const [course, setCourse] = useState<Course | null>(null);
  const [levels, setLevels] = useState<CourseChoice[]>([]);
  const [pending, setPending] = useState<'save' | 'publish' | 'archive' | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  // Levels and course travel together: the select is useless without the catalogue, so a
  // page that half-loaded would show a form with an empty dropdown and no explanation.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);

    const catalogue = courseLevels();
    const document = courseId ? readCourse(courseId) : Promise.resolve(null);

    Promise.all([catalogue, document])
      .then(([items, loaded]) => {
        if (!alive) return;
        setLevels(items);
        setCourse(loaded);
        if (loaded) setValues(ofCourse(loaded));
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

  const isNew = courseId === undefined;
  const locked = course?.status.code === 'published';
  const busy = pending !== null;

  const set = (key: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  /** Empty optional fields are absent on a new course — there is nothing there to clear. */
  function draftInput() {
    return {
      title: values.title.trim(),
      level: values.level,
      ...(values.slug.trim() ? { slug: values.slug.trim() } : {}),
      ...(values.summary.trim() ? { summary: values.summary.trim() } : {}),
      ...(values.description.trim() ? { description: values.description.trim() } : {}),
    };
  }

  /** On an edit the whole document goes, and an emptied box says so — an absent field would
   * leave the old text standing while the teacher watched it disappear from the form. */
  function editInput() {
    return {
      title: values.title.trim(),
      level: values.level,
      summary: values.summary.trim(),
      description: values.description.trim(),
      ...(values.slug.trim() ? { slug: values.slug.trim() } : {}),
    };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || locked) return;

    setPending('save');
    setFields({});
    setFormError(null);

    let saved: Course;
    try {
      saved = courseId
        ? await updateCourse(courseId, editInput())
        : await createCourse(draftInput());
    } catch (error) {
      const perField = fieldErrors(error);
      setFields(perField);
      if (Object.keys(perField).length === 0) setFormError(describeFailure(error));
      setPending(null);
      return;
    }

    setCourse(saved);
    setValues(ofCourse(saved));
    setPending(null);
    notify.success(isNew ? 'Draft created' : 'Saved');
    if (isNew) router.push('/courses');
  }

  async function transition(to: 'publish' | 'archive') {
    if (busy || !course) return;

    setPending(to);
    setFields({});
    setFormError(null);

    try {
      const next = to === 'publish' ? await publishCourse(course.id) : await archiveCourse(course.id);
      setCourse(next);
      setValues(ofCourse(next));
      notify.success(next.status.label === 'Published' ? 'Published' : 'Archived');
    } catch (error) {
      const perField = fieldErrors(error);
      setFields(perField);
      if (Object.keys(perField).length === 0) setFormError(describeFailure(error));
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9.5 w-full rounded-field" />
        <Skeleton className="h-9.5 w-2/3 rounded-field" />
        <Skeleton className="h-9.5 w-full rounded-field" />
        <Skeleton className="h-24 w-full rounded-field" />
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        title="The course did not load"
        message={loadError}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" noValidate>
      {course ? (
        <div className="flex items-center justify-between gap-3">
          <StatusPill tone={STATUS_TONE[course.status.code] ?? 'neutral'}>
            {course.status.label}
          </StatusPill>
          {locked ? (
            <p className="text-[0.8125rem] text-ink-muted">
              Published courses are read-only. Archive it to change what a student is reading.
            </p>
          ) : null}
        </div>
      ) : null}

      {formError ? (
        <p
          role="alert"
          className="rounded-field border border-danger-soft px-3 py-2 text-[0.8125rem] text-danger"
        >
          {formError}
        </p>
      ) : null}

      <Card className="flex flex-col gap-4">
        <TextField
          id="title"
          label="Title"
          hint="What a student sees first. Up to 120 characters."
          value={values.title}
          onChange={(event) => set('title', event.target.value)}
          error={fields.title}
          disabled={busy || locked}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="slug"
            label="Slug"
            hint={
              isNew
                ? 'Optional. Leave it empty and the title becomes the address.'
                : 'The address students see. Changing it breaks any link you have already shared.'
            }
            value={values.slug}
            onChange={(event) => set('slug', event.target.value)}
            error={fields.slug}
            disabled={busy || locked}
          />

          <Select
            id="level"
            label="Level"
            placeholder="Choose a level"
            options={levels.map((choice) => ({ value: choice.code, label: choice.label }))}
            value={values.level}
            onChange={(event) => set('level', event.target.value)}
            error={fields.level}
            disabled={busy || locked}
          />
        </div>

        <TextField
          id="summary"
          label="Summary"
          hint="One line under the title, 180 characters or fewer. Required before publishing."
          value={values.summary}
          onChange={(event) => set('summary', event.target.value)}
          error={fields.summary}
          disabled={busy || locked}
        />

        <Textarea
          id="description"
          label="Description"
          rows={8}
          hint="What the course covers and who it is for. Required before publishing."
          value={values.description}
          onChange={(event) => set('description', event.target.value)}
          error={fields.description}
          disabled={busy || locked}
        />
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {locked ? null : (
          <Button type="submit" loading={pending === 'save'} disabled={locked}>
            {isNew ? 'Save draft' : 'Save'}
          </Button>
        )}

        {course?.status.code === 'draft' ? (
          <Button
            type="button"
            variant="secondary"
            loading={pending === 'publish'}
            disabled={busy}
            onClick={() => void transition('publish')}
          >
            Publish
          </Button>
        ) : null}

        {locked ? (
          <Button
            type="button"
            variant="secondary"
            loading={pending === 'archive'}
            onClick={() => void transition('archive')}
          >
            Archive
          </Button>
        ) : null}
      </div>

      {course?.status.code === 'archived' ? (
        <p className="text-[0.75rem] leading-snug text-ink-faint">
          Archived courses are hidden from students. Their address stays reserved, so nothing
          else can take it.
        </p>
      ) : null}
    </form>
  );
}
