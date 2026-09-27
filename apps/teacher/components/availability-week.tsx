'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Button,
  Calendar,
  Card,
  ErrorState,
  Select,
  SkeletonGroup,
  TextField,
  notify,
  type CalendarDay,
} from '@lms/ui';
import {
  MAX_SLOT_MINUTES,
  MIN_SLOT_MINUTES,
  minutesFromWallClock,
  wallClock,
  WEEKDAY_LABELS,
  type AvailabilityRule,
} from '@lms/shared';

import { describeFailure, fieldErrors } from '@/lib/api';
import { closeWindow, listWindows, moveWindow, openWindow } from '@/lib/availability';

import { useSession } from './session-provider';

/** What the four boxes hold, as the person typed them. The API speaks minutes, a clock face is
 * only how the minutes get in and out of a form. */
interface FormValues {
  weekday: string;
  opens: string;
  closes: string;
  length: string;
}

const BLANK: FormValues = { weekday: '1', opens: '09:00', closes: '10:30', length: '30' };

const DAY_OPTIONS = WEEKDAY_LABELS.map((label, index) => ({
  value: String(index + 1),
  label,
}));

type Settled = { key: string; rules: AvailabilityRule[] };

function ofRule(rule: AvailabilityRule): FormValues {
  return {
    weekday: String(rule.weekday),
    opens: wallClock(rule.startMinutes),
    closes: wallClock(rule.endMinutes),
    length: String(rule.slotMinutes),
  };
}

/**
 * The week a teacher keeps, and the only place it is written.
 *
 * A window is four numbers about a wall clock — which day, when it opens, when it closes, how
 * long a class inside it runs — and the grid is those numbers drawn as a week rather than a
 * table. Nothing here decides whether a window is well-formed: the API answers that (a class has
 * to fit, no two windows may cover a minute), and its message goes on the box it names. The
 * portal's own refusal is the one a round trip cannot improve on: a clock face that is not a
 * face, which would otherwise come back as `Give the time as minutes from midnight`.
 *
 * The grid is re-read after every write rather than patched in place. A save can be refused for
 * a reason that involves the *other* windows — an overlap the teacher can see but this screen
 * has no rule for — and the week the API describes is the one worth drawing.
 */
export function AvailabilityWeek() {
  const { user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [values, setValues] = useState<FormValues>(BLANK);
  const [selected, setSelected] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState<'save' | 'close' | null>(null);

  const key = String(attempt);

  useEffect(() => {
    let alive = true;

    listWindows()
      .then((rules) => {
        if (alive) setSettled({ key, rules });
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [key]);

  // Only the first load is a skeleton. A refresh after a save keeps the week it is replacing on
  // screen — a teacher who has just moved a window is not interested in watching the form they
  // typed into disappear, and a grid that vanishes between two answers reads as a failure.
  const week = settled?.rules ?? [];
  const loading = settled === null;
  const failed = settled?.key !== key && failure?.key === key ? failure : null;
  const refreshing = settled !== null && settled.key !== key;
  const busy = pending !== null || refreshing;

  const set = (field: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  function reload() {
    setAttempt((current) => current + 1);
  }

  function pick(rule: AvailabilityRule) {
    setSelected(rule.id === selected ? null : rule.id);
    setValues(rule.id === selected ? BLANK : ofRule(rule));
    setFields({});
  }

  /** The four boxes as the four numbers, or the boxes that failed to be numbers. */
  function toInput(local: Record<string, string[]>): FormValuesToNumbers | null {
    const weekday = Number(values.weekday);
    const length = Number(values.length);
    let failed = false;

    const startMinutes = readClock(values.opens, 'opens', local);
    const endMinutes = readClock(values.closes, 'closes', local);
    if (startMinutes === null || endMinutes === null) failed = true;

    if (!Number.isInteger(length) || length < MIN_SLOT_MINUTES || length > MAX_SLOT_MINUTES) {
      local.length = [`A class runs from ${MIN_SLOT_MINUTES} to ${MAX_SLOT_MINUTES} minutes.`];
      failed = true;
    }

    if (failed) return null;
    return {
      weekday,
      startMinutes: startMinutes as number,
      endMinutes: endMinutes as number,
      slotMinutes: length,
    };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const local: Record<string, string[]> = {};
    const input = toInput(local);
    if (input === null) {
      setFields(local);
      return;
    }

    setPending('save');
    setFields({});

    try {
      if (selected) await moveWindow(selected, input);
      else await openWindow(input);
    } catch (error) {
      const perField = fieldErrors(error);
      setFields(perField);
      if (Object.keys(perField).length === 0) notify.error(describeFailure(error));
      setPending(null);
      return;
    }

    setPending(null);
    setSelected(null);
    setValues(BLANK);
    notify.success(selected ? 'Window moved' : 'Window opened');
    reload();
  }

  async function close() {
    if (busy || !selected) return;

    setPending('close');
    setFields({});

    try {
      await closeWindow(selected);
    } catch (error) {
      setFields(fieldErrors(error));
      notify.error(describeFailure(error));
      setPending(null);
      return;
    }

    setPending(null);
    setSelected(null);
    setValues(BLANK);
    notify.success('Window closed');
    reload();
  }

  if (failed) {
    return (
      <ErrorState
        title="The week did not load"
        message={failed.message}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  if (loading) {
    return (
      <SkeletonGroup
        rows={2}
        rowClassName="h-[13.5rem] w-full rounded-card"
        label="Loading your week"
        className="flex flex-col gap-4"
      />
    );
  }

  const zone = user?.timezone ?? 'your own clock';

  return (
    <div className="flex flex-col gap-5">
      {week.length === 0 ? (
        <p className="text-label text-ink-muted">
          No windows yet — a teacher with no windows has no classes to book.
        </p>
      ) : (
        <Calendar
          label="Your week"
          caption={`Your clock, ${zone}`}
          days={weekOf(week, selected, pick)}
          busy={busy}
        />
      )}

      <form
        onSubmit={(event) => void save(event)}
        className="flex max-w-2xl flex-col gap-4"
        noValidate
      >
        <Card className="flex flex-col gap-4">
          <p className="text-[0.8125rem] text-ink-muted">
            {selected
              ? 'The window is loaded here. Change what you like and save it back onto the week.'
              : 'A window is the stretch you keep open, and the class length cuts it into the minutes a student books.'}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id="weekday"
              label="Day"
              options={DAY_OPTIONS}
              value={values.weekday}
              onChange={(event) => set('weekday', event.target.value)}
              error={fields.weekday}
              disabled={busy}
            />

            <TextField
              id="length"
              label="Class length"
              type="number"
              inputMode="numeric"
              min={MIN_SLOT_MINUTES}
              max={MAX_SLOT_MINUTES}
              step={5}
              hint="Minutes."
              value={values.length}
              onChange={(event) => set('length', event.target.value)}
              error={fields.length}
              disabled={busy}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="opens"
              label="Opens"
              type="time"
              value={values.opens}
              onChange={(event) => set('opens', event.target.value)}
              error={fields.startMinutes ?? fields.opens}
              disabled={busy}
            />

            <TextField
              id="closes"
              label="Closes"
              type="time"
              hint="A class has to finish inside the window."
              value={values.closes}
              onChange={(event) => set('closes', event.target.value)}
              error={fields.endMinutes ?? fields.closes}
              disabled={busy}
            />
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={pending === 'save'} disabled={busy}>
            {selected ? 'Save window' : 'Add window'}
          </Button>

          {selected ? (
            <>
              <Button
                type="button"
                variant="secondary"
                loading={pending === 'close'}
                disabled={busy}
                onClick={() => void close()}
              >
                Close this window
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setValues(BLANK);
                  setFields({});
                }}
              >
                Leave it alone
              </Button>
            </>
          ) : null}
        </div>
      </form>
    </div>
  );
}

/** The seven columns, in the order a teacher reads one. */
function weekOf(
  rules: AvailabilityRule[],
  selected: string | null,
  pick: (rule: AvailabilityRule) => void,
): CalendarDay[] {
  return WEEKDAY_LABELS.map((label, index) => {
    const weekday = index + 1;
    const onDay = rules.filter((rule) => rule.weekday === weekday);

    return {
      key: `weekday-${weekday}`,
      weekday: label.slice(0, 3),
      chips: onDay.map((rule) => ({
        id: rule.id,
        label: `${wallClock(rule.startMinutes)}–${wallClock(rule.endMinutes)}`,
        tone: rule.id === selected ? ('selected' as const) : ('available' as const),
        ariaLabel: `${label} ${wallClock(rule.startMinutes)}–${wallClock(
          rule.endMinutes,
        )} · ${rule.slotMinutes}-minute classes`,
        onSelect: () => pick(rule),
      })),
      ...(onDay.length === 0 ? { empty: 'No window' } : {}),
    };
  });
}

type FormValuesToNumbers = {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
};

/** A clock face, or the message that goes on the box that holds it. */
function readClock(face: string, field: string, local: Record<string, string[]>): number | null {
  const minutes = minutesFromWallClock(face.trim());
  if (minutes === null) {
    local[field] = ['Give a time the clock could show, like 09:00.'];
    return null;
  }
  return minutes;
}
