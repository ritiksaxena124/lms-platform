'use client';

import { useEffect, useState } from 'react';
import { Button, ErrorState, Icon, SkeletonGroup, notify } from '@lms/ui';
import {
  API_ERROR_CODES,
  ATTENDANCE_STATUS_CODES,
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatusCode,
  type ClassRoll,
} from '@lms/shared';

import { ApiError, describeFailure } from '@/lib/api';
import { myClassRoll, saveClassRoll } from '@/lib/class-roll';
import { formatClassWindow, readerZone } from '@/lib/dates';

import { useSession } from './session-provider';

/** The two words a line can be marked with, in the order a teacher reads a sheet down. */
const MARKS = [ATTENDANCE_STATUS_CODES.PRESENT, ATTENDANCE_STATUS_CODES.ABSENT] as const;

type Marks = Record<string, AttendanceStatusCode | null>;

function marksOf(sheet: ClassRoll): Marks {
  const next: Marks = {};
  for (const line of sheet.lines) next[line.student.id] = line.status;
  return next;
}

/**
 * The sheet a teacher goes down after a class.
 *
 * One class, one list of names, one press that writes them all — because that is the act. A teacher
 * does not mark a student and then think about the next one; they remember the room and work down
 * the names, so the save is the whole sheet and an unpressed line stays exactly as unmarked as it
 * was.
 *
 * Pressing the word a line already wears takes it off. Unmarked is a real state here — nobody has
 * said anything about that name yet — and the only way to get back to it from a wrong mark is a
 * second press, since a third word for "not yet" would put a label on the absence of one.
 *
 * What the screen shows after a save is the roll the API read back, not the marks that were typed.
 * Between the read and the press somebody else may have moved the class or the places under it, and
 * a screen that rendered its own guess would be a teacher believing a mark the table never took.
 * The same reason turns a refusal that says the class is gone into a refresh.
 */
export function RollSheet({ classId }: { classId: string }) {
  const { user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ key: string; sheet: ClassRoll } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [busy, setBusy] = useState(false);

  const key = String(attempt);

  useEffect(() => {
    let alive = true;

    myClassRoll(classId)
      .then((sheet) => {
        if (!alive) return;
        setSettled({ key, sheet });
        setMarks(marksOf(sheet));
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [classId, key]);

  function reload() {
    setAttempt((current) => current + 1);
  }

  const failed = settled?.key !== key && failure?.key === key ? failure : null;

  if (failed) {
    return (
      <ErrorState
        title="The roll did not load"
        message={failed.message}
        onRetry={reload}
        busy={busy}
      />
    );
  }

  if (settled === null) {
    return (
      <SkeletonGroup rows={4} rowClassName="h-14" label="Loading the roll" className="space-y-3" />
    );
  }

  const { sheet } = settled;
  const zone = readerZone(user?.timezone);

  const tally = { present: 0, absent: 0, unmarked: 0 };
  for (const line of sheet.lines) {
    const mark = marks[line.student.id];
    if (mark === ATTENDANCE_STATUS_CODES.PRESENT) tally.present += 1;
    else if (mark === ATTENDANCE_STATUS_CODES.ABSENT) tally.absent += 1;
    else tally.unmarked += 1;
  }

  const dirty = sheet.lines.some((line) => marks[line.student.id] !== line.status);

  function toggle(studentId: string, word: AttendanceStatusCode) {
    setMarks((current) => ({
      ...current,
      [studentId]: current[studentId] === word ? null : word,
    }));
  }

  async function save() {
    setBusy(true);
    try {
      const saved = await saveClassRoll(classId, {
        lines: sheet.lines.map((line) => ({
          studentId: line.student.id,
          status: marks[line.student.id] ?? null,
        })),
      });

      setSettled({ key, sheet: saved });
      setMarks(marksOf(saved));
      notify.success('Roll saved');
    } catch (error: unknown) {
      notify.error(describeFailure(error));
      // A class that is no longer there, or no longer markable, is a fact about the sheet rather
      // than about the press: the read the teacher worked from was right when it landed.
      if (
        error instanceof ApiError &&
        (error.code === API_ERROR_CODES.NOT_FOUND || error.code === API_ERROR_CODES.CONFLICT)
      ) {
        reload();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-h2 text-ink-strong">{sheet.course.title}</h2>
        <p className="mt-0.5 tabular text-[0.8125rem] text-ink">
          <Icon name="clock" size="sm" />
          <span className="ml-1.5">{formatClassWindow(sheet.startsAt, sheet.endsAt, zone)}</span>
          <span className="text-ink-faint">{` · your clock, ${zone}`}</span>
        </p>
      </div>

      {sheet.lines.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-paper px-4 py-5 text-[0.8125rem] text-ink-muted">
          Nobody is on this roll yet — a class stands for the places its course holds, and this one
          holds none.
        </p>
      ) : (
        <>
          <p className="text-label text-ink">{`${tally.present} present · ${tally.absent} absent · ${tally.unmarked} unmarked`}</p>

          <ul aria-label="The roll" className="flex flex-col gap-3">
            {sheet.lines.map((line) => (
              <li
                key={line.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-surface p-4"
              >
                <span className="min-w-0 text-[0.9375rem] text-ink-strong">
                  {line.student.fullName}
                </span>

                <div className="flex items-center gap-2">
                  {MARKS.map((word) => (
                    <Button
                      key={word}
                      type="button"
                      size="sm"
                      variant={marks[line.student.id] === word ? 'primary' : 'secondary'}
                      aria-pressed={marks[line.student.id] === word}
                      aria-label={`${ATTENDANCE_STATUS_LABELS[word]} ${line.student.fullName}`}
                      disabled={!sheet.canMark || busy}
                      onClick={() => toggle(line.student.id, word)}
                    >
                      {ATTENDANCE_STATUS_LABELS[word]}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          {sheet.canMark ? (
            <div className="flex items-center gap-3">
              <Button type="button" onClick={() => void save()} disabled={!dirty} loading={busy}>
                Save roll
              </Button>
              {dirty && !busy ? (
                <span className="text-[0.8125rem] text-ink-faint">Not saved yet</span>
              ) : null}
            </div>
          ) : (
            <p className="text-[0.8125rem] text-ink-faint">
              The roll opens when the class starts. Until then there is nothing to say about a name
              that has not been stood for.
            </p>
          )}
        </>
      )}
    </div>
  );
}
