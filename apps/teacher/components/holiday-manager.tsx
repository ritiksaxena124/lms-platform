'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  ErrorState,
  SkeletonGroup,
  TextField,
  notify,
} from '@lms/ui';
import type { Holiday } from '@lms/shared';

import { describeFailure, fieldErrors } from '@/lib/api';
import { addHoliday, listHolidays, retireHoliday, updateHoliday } from '@/lib/holidays';

interface FormValues {
  date: string;
  reason: string;
  recurring: boolean;
}

const BLANK: FormValues = { date: '', reason: '', recurring: false };

/**
 * The days this teacher does not teach.
 *
 * A holiday is personal — one teacher's festival is another teacher's working day. Recurring
 * annually means this date is blocked every year (Diwali, Christmas); a one-off blocks only the
 * stated year.
 */
export function HolidayManager() {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ key: string; holidays: Holiday[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [values, setValues] = useState<FormValues>(BLANK);
  const [selected, setSelected] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<'save' | 'retire' | null>(null);

  const key = String(attempt);
  const holidays = settled?.holidays ?? [];
  const loading = settled === null;
  const failed = settled?.key !== key && failure?.key === key ? failure : null;

  useEffect(() => {
    let alive = true;
    listHolidays()
      .then((items) => { if (alive) setSettled({ key, holidays: items }); })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });
    return () => { alive = false; };
  }, [key]);

  const set = (field: keyof FormValues, value: string | boolean) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  function reload() {
    setAttempt((current) => current + 1);
  }

  function pick(h: Holiday) {
    setSelected(h.id === selected ? null : h.id);
    setValues(h.id === selected ? BLANK : {
      date: h.date,
      reason: h.reason ?? '',
      recurring: h.isRecurringAnnual,
    });
    setFields({});
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFields({});

    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
      setFields({ date: ['Give the date as YYYY-MM-DD (e.g. 2026-12-25).'] });
      return;
    }

    setBusy('save');
    try {
      const input = {
        date: values.date,
        reason: values.reason || undefined,
        isRecurringAnnual: values.recurring,
      };

      if (selected) {
        await updateHoliday(selected, input);
        notify.success('Holiday updated');
      } else {
        await addHoliday(input);
        notify.success('Holiday added');
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
      await retireHoliday(id);
      notify.success('Holiday retired');
      // The row leaves the list, so the form it was opened from has nothing left to edit.
      setSelected(null);
      setValues(BLANK);
      setFields({});
      reload();
    } catch (error: unknown) {
      notify.error(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  if (failed) {
    return (
      <ErrorState
        title="The holidays did not load"
        message={failed.message}
        onRetry={reload}
        busy={busy !== null}
      />
    );
  }

  if (loading) {
    return (
      <SkeletonGroup
        rows={3}
        rowClassName="h-14"
        label="Loading your holidays"
        className="space-y-3"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Holiday list */}
      {holidays.length > 0 ? (
        <Card className="divide-y divide-line">
          {holidays.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => pick(h)}
              className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-paper-sunk ${
                selected === h.id ? 'bg-brand-soft' : ''
              }`}
            >
              <div>
                <p className="font-medium text-ink">{h.date}</p>
                <p className="text-sm text-ink-muted">
                  {h.reason ?? 'No reason given'}
                  {h.isRecurringAnnual && ' · Recurs annually'}
                </p>
              </div>
              {selected === h.id && (
                <span className="text-xs font-semibold text-brand">Editing</span>
              )}
            </button>
          ))}
        </Card>
      ) : (
        <Card className="p-6 text-center text-ink-muted">
          No holidays yet. Add days you won't be teaching below.
        </Card>
      )}

      {/* Form */}
      <form onSubmit={save} className="space-y-3">
        <TextField
          id="holiday-date"
          label="Date"
          value={values.date}
          onChange={(event) => set('date', event.target.value)}
          placeholder="2026-12-25"
          error={fields.date?.[0]}
        />
        <TextField
          id="holiday-reason"
          label="Reason (optional)"
          value={values.reason}
          onChange={(event) => set('reason', event.target.value)}
          placeholder="Diwali"
        />
        <Checkbox
          id="holiday-recurring"
          label="Recur annually (blocks this date every year)"
          checked={values.recurring}
          onChange={(event) => set('recurring', event.target.checked)}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={busy !== null}>
            {selected ? 'Update holiday' : 'Add holiday'}
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
            variant="danger"
            size="sm"
            onClick={() => retire(selected)}
            disabled={busy !== null}
          >
            Retire this holiday
          </Button>
          <p className="mt-1 text-xs text-ink-faint">
            Retired holidays no longer block slot generation.
          </p>
        </div>
      )}
    </div>
  );
}
