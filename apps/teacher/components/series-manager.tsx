'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  ErrorState,
  Select,
  SkeletonGroup,
  TextField,
  notify,
} from '@lms/ui';
import {
  MAX_SLOT_MINUTES,
  MIN_SLOT_MINUTES,
  minutesFromWallClock,
  wallClock,
  WEEKDAY_LABELS,
  type ClassSeries,
} from '@lms/shared';

import { describeFailure, fieldErrors } from '@/lib/api';
import { addSeries, listSeries, retireSeries, updateSeries } from '@/lib/calendar';

interface FormValues {
  weekday: string;
  opens: string;
  closes: string;
  length: string;
}

const BLANK: FormValues = { weekday: '1', opens: '09:00', closes: '10:00', length: '45' };

const DAY_OPTIONS = WEEKDAY_LABELS.map((label, index) => ({
  value: String(index + 1),
  label,
}));

interface SeriesManagerProps {
  courseId: string;
}

/**
 * The recurring weekly slots for one course.
 *
 * A series is a plan — Monday at 09:00–10:00 as a 45-minute class — and the booking endpoint
 * will auto-enroll students into every instance. The grid shows what's running; clicking one
 * lets you adjust its times or retire it.
 */
export function SeriesManager({ courseId }: SeriesManagerProps) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ key: string; series: ClassSeries[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [values, setValues] = useState<FormValues>(BLANK);
  const [selected, setSelected] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<'save' | 'retire' | null>(null);

  const key = String(attempt);
  const series = settled?.series ?? [];
  const loading = settled === null;
  const failed = settled?.key !== key && failure?.key === key ? failure : null;

  useEffect(() => {
    let alive = true;
    listSeries(courseId)
      .then((items) => { if (alive) setSettled({ key, series: items }); })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });
    return () => { alive = false; };
  }, [courseId, key]);

  const set = (field: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  function reload() {
    setAttempt((current) => current + 1);
  }

  function pick(s: ClassSeries) {
    setSelected(s.id === selected ? null : s.id);
    setValues(s.id === selected ? BLANK : {
      weekday: String(s.weekday),
      opens: wallClock(s.startMinutes),
      closes: wallClock(s.endMinutes),
      length: String(s.durationMinutes),
    });
    setFields({});
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFields({});

    const startMin = minutesFromWallClock(values.opens);
    const endMin = minutesFromWallClock(values.closes);
    const durMin = Number(values.length);

    if (startMin === null || endMin === null) {
      setFields({ opens: ['Give the time as HH:MM (e.g. 09:00).'], closes: ['Give the time as HH:MM.'] });
      return;
    }

    if (endMin <= startMin) {
      setFields({ closes: ['The window must end after it starts.'] });
      return;
    }

    if (durMin < MIN_SLOT_MINUTES || durMin > MAX_SLOT_MINUTES) {
      setFields({ length: [`A class runs from ${MIN_SLOT_MINUTES} to ${MAX_SLOT_MINUTES} minutes.`] });
      return;
    }

    if (durMin > endMin - startMin) {
      setFields({ length: ['The class does not fit inside the window.'] });
      return;
    }

    setBusy('save');
    try {
      const input = {
        weekday: Number(values.weekday),
        startMinutes: startMin,
        endMinutes: endMin,
        durationMinutes: durMin,
      };

      if (selected) {
        await updateSeries(courseId, selected, input);
        notify.success('Series updated');
      } else {
        await addSeries(courseId, input);
        notify.success('Series added');
      }

      setValues(BLANK);
      setSelected(null);
      reload();
    } catch (error: unknown) {
      const errs = fieldErrors(error);
      if (errs) {
        setFields(errs);
      } else {
        notify.error(describeFailure(error));
      }
    } finally {
      setBusy(null);
    }
  }

  async function retire(id: string) {
    setBusy('retire');
    try {
      await retireSeries(courseId, id);
      notify.success('Series retired');
      reload();
    } catch (error: unknown) {
      notify.error(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <SkeletonGroup>
        <Card className="p-4">
          <div className="h-6 w-32 rounded bg-slate-200" />
          <div className="mt-4 space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100" />
            ))}
          </div>
        </Card>
      </SkeletonGroup>
    );
  }

  if (failed) {
    return <ErrorState message={failed.message} onRetry={reload} />;
  }

  return (
    <div className="space-y-4">
      {/* Series list */}
      {series.length > 0 ? (
        <Card className="divide-y divide-line">
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pick(s)}
              className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-paper-sunk ${
                selected === s.id ? 'bg-brand-soft' : ''
              }`}
            >
              <div>
                <p className="font-medium text-ink">{WEEKDAY_LABELS[s.weekday - 1]}</p>
                <p className="text-sm text-ink-muted">
                  {wallClock(s.startMinutes)}–{wallClock(s.endMinutes)} ({s.durationMinutes} min)
                </p>
              </div>
              {selected === s.id && (
                <span className="text-xs font-semibold text-brand">Editing</span>
              )}
            </button>
          ))}
        </Card>
      ) : (
        <Card className="p-6 text-center text-ink-muted">
          No series yet. Add your first recurring class slot below.
        </Card>
      )}

      {/* Form */}
      <form onSubmit={save} className="space-y-3">
        <Select
          label="Day"
          value={values.weekday}
          onChange={(v) => set('weekday', v)}
          options={DAY_OPTIONS}
          error={fields.weekday?.[0]}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Opens"
            value={values.opens}
            onChange={(v) => set('opens', v)}
            placeholder="09:00"
            error={fields.opens?.[0]}
          />
          <TextField
            label="Closes"
            value={values.closes}
            onChange={(v) => set('closes', v)}
            placeholder="10:00"
            error={fields.closes?.[0]}
          />
        </div>
        <TextField
          label="Class length (minutes)"
          value={values.length}
          onChange={(v) => set('length', v)}
          placeholder="45"
          error={fields.length?.[0]}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={busy !== null}>
            {selected ? 'Update series' : 'Add series'}
          </Button>
          {selected && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSelected(null);
                setValues(BLANK);
                setFields({});
              }}
              disabled={busy !== null}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>

      {/* Retire button for selected */}
      {selected && (
        <div className="border-t border-line pt-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => retire(selected)}
            disabled={busy !== null}
          >
            Retire this series
          </Button>
          <p className="mt-1 text-xs text-ink-faint">
            Retired series stop generating new instances but keep their history.
          </p>
        </div>
      )}
    </div>
  );
}
