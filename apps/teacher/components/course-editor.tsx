'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  ErrorState,
  InfoTip,
  Select,
  Skeleton,
  StatusPill,
  Textarea,
  TextField,
  notify,
  type StatusTone,
} from '@lms/ui';
import type { Course, CourseChoice, CoursePriceInput } from '@lms/shared';
import { fromMinorUnits, toMinorUnits } from '@lms/shared';

import { describeFailure, fieldErrors } from '@/lib/api';
import {
  archiveCourse,
  courseCurrencies,
  courseLevels,
  createCourse,
  publishCourse,
  readCourse,
  unarchiveCourse,
  unpublishCourse,
  updateCourse,
} from '@/lib/courses';

const STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  published: 'success',
  archived: 'warning',
};

/**
 * The four moves a course can be asked to make, one per API route.
 *
 * Each carries the sentence the toast says when it succeeds, and that sentence is the only place
 * the portal states what the move did: the status itself is painted from the row the API answered
 * with. Both `unpublish` and `unarchive` land on draft and the portal does not say so anywhere in
 * a request — which state a transition comes back to is the API's rule, and repeating it here
 * would be a second copy free to disagree.
 */
const TRANSITIONS = {
  publish: { run: publishCourse, done: 'Published' },
  unpublish: { run: unpublishCourse, done: 'Unpublished' },
  archive: { run: archiveCourse, done: 'Archived' },
  unarchive: { run: unarchiveCourse, done: 'Brought back as a draft' },
} as const;

type Transition = keyof typeof TRANSITIONS;

/** What the form holds, before anything knows whether it is a new course or an old one. */
interface FormValues {
  title: string;
  slug: string;
  level: string;
  summary: string;
  description: string;
  /** The amount as the teacher typed it, and the currency it is in. Two boxes, one decision —
   * see `priceInput`. */
  priceAmount: string;
  priceCurrency: string;
}

const BLANK: FormValues = {
  title: '',
  slug: '',
  level: '',
  summary: '',
  description: '',
  priceAmount: '',
  priceCurrency: '',
};

/** The currency picker's own first row: a course with no price on it is a choice a teacher
 * makes, not an empty box, so it is named rather than left blank. */
const NO_PRICE = { value: '', label: 'No price' };

function ofCourse(course: Course): FormValues {
  return {
    title: course.title,
    slug: course.slug,
    level: course.level.code,
    summary: course.summary ?? '',
    description: course.description ?? '',
    priceAmount: course.price
      ? fromMinorUnits(course.price.minorUnits, course.price.currency.code)
      : '',
    priceCurrency: course.price?.currency.code ?? '',
  };
}

/** What the load asked the API for, and whether it is still owed an answer. `key` tags the
 * bundle with the request that earned it, so loading is derived from whether the answer matches
 * the current key rather than announced by a flag set inside the effect (§13). */
type Loaded = { levels: CourseChoice[]; currencies: CourseChoice[]; course: Course | null };
type Load = { key: string; value: Loaded } | { key: string; error: string };

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
  const [pending, setPending] = useState<'save' | Transition | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load | null>(null);

  // The request is keyed on which course this is and how many times it has been asked for, so
  // an answer is only ever an answer to *that* request. A retry gets a new key; the old reply
  // can no longer match it.
  const key = `${courseId ?? 'new'}:${attempt}`;

  // Catalogue and course travel together: a select with no options and a form with no values
  // would be a page that half-loaded, and a teacher cannot tell the difference.
  useEffect(() => {
    let alive = true;

    const catalogues = Promise.all([courseLevels(), courseCurrencies()]);
    const document = courseId ? readCourse(courseId) : Promise.resolve(null);

    Promise.all([catalogues, document])
      .then(([[levelRows, currencyRows], loaded]) => {
        if (!alive) return;
        setLoad({ key, value: { levels: levelRows, currencies: currencyRows, course: loaded } });
        setCourse(loaded);
        if (loaded) setValues(ofCourse(loaded));
      })
      .catch((error: unknown) => {
        if (alive) setLoad({ key, error: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [key, courseId]);

  const isNew = courseId === undefined;
  const locked = course?.status.code === 'published';
  const busy = pending !== null;

  // Loading and failure are read off the answer's key, never set as flags: an answer tagged with
  // some earlier key has not arrived for *this* request, so the skeleton stays up rather than a
  // half-loaded form flashing under a course the teacher did not open.
  const settled = load && load.key === key ? load : null;
  const loading = settled === null;
  const loadError = settled && 'error' in settled ? settled.error : null;
  const loaded = settled && 'value' in settled ? settled.value : null;
  const levels = loaded?.levels ?? [];
  const currencies = loaded?.currencies ?? [];

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

  /**
   * The two boxes as the pair the API wants.
   *
   * Both empty is `null` — the same sentence an emptied summary says — and one box empty while
   * the other is full is a mistake the form does not send up to be refused: the answer would
   * name a box the teacher can already see is empty, one round trip later. Anything the API
   * still disagrees with (a currency the catalogue dropped since this page loaded) comes back
   * as a field error like any other.
   *
   * The amount is turned into minor units here and nowhere else in the portal, so a figure has
   * exactly one place where it is multiplied before it reaches a column.
   */
  function priceInput(local: Record<string, string[]>): { price: CoursePriceInput | null } {
    const amount = values.priceAmount.trim();
    const currency = values.priceCurrency;

    if (!amount && !currency) return { price: null };
    if (!currency) {
      local.currency = ['Choose which currency this is, or clear the amount too.'];
      return { price: null };
    }
    if (!amount) {
      local.minorUnits = ['Give an amount, or clear the currency too.'];
      return { price: null };
    }

    try {
      return { price: { minorUnits: toMinorUnits(amount, currency), currency } };
    } catch {
      local.minorUnits = ['Digits, and one decimal point at most — 4999, or 4999.50.'];
      return { price: null };
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || locked) return;

    const local: Record<string, string[]> = {};
    const price = priceInput(local);
    if (Object.keys(local).length > 0) {
      setFields(local);
      return;
    }

    setPending('save');
    setFields({});
    setFormError(null);

    let saved: Course;
    try {
      const body = { ...(courseId ? editInput() : draftInput()), ...price };
      saved = courseId ? await updateCourse(courseId, body) : await createCourse(body);
    } catch (error) {
      let perField = fieldErrors(error);
      // The API names a price as one field, and the only thing left to complain about once it
      // has an amount and a unit is the unit — so the message goes where it was chosen.
      if (perField.price) {
        perField = {
          ...perField,
          currency: [...(perField.currency ?? []), ...perField.price],
        };
        delete perField.price;
      }
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

  async function transition(to: Transition) {
    if (busy || !course) return;

    setPending(to);
    setFields({});
    setFormError(null);

    try {
      const next = await TRANSITIONS[to].run(course.id);
      setCourse(next);
      setValues(ofCourse(next));
      notify.success(TRANSITIONS[to].done);
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
              Published courses are read-only. Unpublish to edit — students already enrolled keep
              reading it. Archive ends it for them too.
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

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="priceAmount"
            label="Price"
            inputMode="decimal"
            autoComplete="off"
            placeholder="4999.00"
            hint="Optional, and a quote rather than a checkout — a place in a course is still taken for free. ₹4,999 goes in as 4999."
            value={values.priceAmount}
            onChange={(event) => set('priceAmount', event.target.value)}
            error={fields.minorUnits}
            disabled={busy || locked}
          />

          <Select
            id="priceCurrency"
            label="Currency"
            options={[
              NO_PRICE,
              ...currencies.map((choice) => ({ value: choice.code, label: choice.label })),
            ]}
            value={values.priceCurrency}
            onChange={(event) => set('priceCurrency', event.target.value)}
            error={fields.currency}
            disabled={busy || locked}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {locked ? null : (
          <Button type="submit" loading={pending === 'save'} disabled={locked}>
            {isNew ? 'Save draft' : 'Save'}
          </Button>
        )}

        {course?.status.code === 'draft' ? (
          <span className="flex items-center gap-1">
            <Button
              type="button"
              variant="secondary"
              loading={pending === 'publish'}
              disabled={busy}
              onClick={() => void transition('publish')}
            >
              Publish
            </Button>
            <InfoTip label="What Publish does">
              Puts the course on the shelf, lets a student take a place, and locks the form.
            </InfoTip>
          </span>
        ) : null}

        {locked ? (
          <>
            {/* The two ways off the shelf are offered together, because they are not two strengths
                of the same move: unpublishing pauses a course its students keep reading, and
                archiving ends it for everybody. Naming only one would decide for the teacher. Each
                carries its own sentence for the same reason — the names are two steps apart and the
                consequences are a world apart. */}
            <span className="flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                loading={pending === 'unpublish'}
                onClick={() => void transition('unpublish')}
              >
                Unpublish
              </Button>
              <InfoTip label="What Unpublish does">
                Off the shelf for strangers, editable again for you, and still open to every student
                who holds a place.
              </InfoTip>
            </span>
            <span className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                loading={pending === 'archive'}
                onClick={() => void transition('archive')}
              >
                Archive
              </Button>
              <InfoTip label="What Archive does">
                Ends the course for everybody, including the students who hold a place in it.
              </InfoTip>
            </span>
          </>
        ) : null}

        {course?.status.code === 'archived' ? (
          <span className="flex items-center gap-1">
            <Button
              type="button"
              variant="secondary"
              loading={pending === 'unarchive'}
              disabled={busy}
              onClick={() => void transition('unarchive')}
            >
              Bring it back as a draft
            </Button>
            <InfoTip label="What bringing it back does">
              Returns the course to you as a draft, at the address it never lost. Putting it back on
              the shelf is a separate decision.
            </InfoTip>
          </span>
        ) : null}
      </div>

      {course?.status.code === 'archived' ? (
        <p className="text-[0.75rem] leading-snug text-ink-faint">
          Archived courses are hidden from students, including the ones who took a place. Bringing
          one back returns it as a draft — its address has stayed reserved the whole time, and
          putting it on the shelf again is a separate decision.
        </p>
      ) : null}
    </form>
  );
}
