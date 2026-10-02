import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  OCCURRENCE_HORIZON_DAYS,
  expandSeries,
  type AssignedClass,
  type AttendanceStatusCode,
  type LearningClassesResponse,
  type ScheduledClass,
  type SeriesPattern,
  type TeachingClassesResponse,
} from '@lms/shared';

import { AppLogger } from '../../common/logging/app-logger.service';
import { EnrollmentsRepository } from '../enrollments/enrollments.repository';
import { CalendarRepository } from './calendar.repository';
import { ClassOccurrenceRepository, type NewOccurrence } from './class-occurrence.repository';
import type { ListClassesQueryDto } from './dto/list-classes-query.dto';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Turns a teacher's plan into the classes on their calendar, and reads them back.
 *
 * A series is a sentence about a week — "Monday at nine, an hour" — and nothing in the platform can
 * attend a sentence. This service is the step that writes the dated rows the sentence stands for and
 * keeps them true: one per class, with a register of names beside each, over the horizon a month
 * forward.
 *
 * It is a **reconcile**, not a generator. Each run works out what the calendar should hold *now* and
 * moves the rows that differ, which is the only shape that survives the two things that keep
 * changing a plan: a teacher editing it at midnight on a Tuesday, and a second API instance running
 * the same clock. A generator that appended would leave the classes an edited pattern no longer
 * stands for on the calendar forever, and a generator that rebuilt would delete rows the register
 * points at.
 *
 * Three doors call it, and all three are the same question:
 *
 * - The clock, hourly, as `class-occurrence-generation` — the door with nobody behind it, which is
 *   also what eventually gives a student who enrolled late their lines in the classes still to come.
 * - Every write a teacher makes to a series or a holiday, so the screen a person is looking at is
 *   right the moment they close the form. An hour of a calendar that disagrees with the plan the
 *   teacher just edited is not a delay, it is a bug they have to notice.
 * - Nothing else. A dated class is not a row a caller may write: the pattern owns it, and a route
 *   that accepted one would be a way to put a class on a calendar nobody scheduled.
 *
 * The horizon starts at the moment it is standing in rather than at the beginning of the week, and
 * that is the whole of how history is protected. A class whose minute has passed is not in any
 * run's window, so no later edit — a day off, a retirement, a moved hour — can reach back and
 * change what happened that day. Past rows are answered by §Stage 3's register, not by this sweep.
 */
@Injectable()
export class ClassOccurrenceService {
  private readonly logger = new AppLogger();

  constructor(
    private readonly occurrences: ClassOccurrenceRepository,
    private readonly calendar: CalendarRepository,
    private readonly enrollments: EnrollmentsRepository,
  ) {}

  /**
   * Fill every teacher's calendar on the wall clock.
   *
   * Hourly, the same beat that ends an unanswered class request, so one clock runs the two sweeps
   * the platform's calendar depends on. Teachers are visited rather than the clock visiting every
   * account: an account with no live plan has no rows to move.
   *
   * Overlapping runs are harmless for the same reason `createMany({ skipDuplicates })` is — every
   * write here is keyed by the pair the database already guards, so two instances reconciling the
   * same week land on the same rows.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'class-occurrence-generation' })
  async sweepOnClock(): Promise<void> {
    const changed = await this.sweep(new Date());
    if (changed > 0) {
      this.logger.log(`Reconciled ${changed} cohort class row(s)`, 'ClassOccurrence');
    }
  }

  /** Every teacher with a live plan, reconciled as of `now`. Returns how many rows moved. */
  async sweep(now: Date): Promise<number> {
    const teachers = await this.occurrences.listTeachersWithSeries();
    let changed = 0;
    for (const teacherUserId of teachers) {
      changed += await this.reconcileTeacher(teacherUserId, now);
    }
    return changed;
  }

  /**
   * Make one teacher's forward calendar true, and keep the registers beside it in step.
   *
   * Two passes, because the second question depends on the answer to the first. The classes are
   * worked out from the patterns — the shared arithmetic in `expandSeries`, so a screen and this
   * sweep cannot disagree about what a Monday means — then diffed against the rows in the horizon,
   * which opens what a lifted blocker freed and retires what a pattern no longer stands for.
   *
   * Only then are the registers written, over the classes that stand *after* that diff: a name
   * belongs on the sheet of a class that is going to happen, and a sheet written from a stale list
   * would name people for a class this run just closed.
   *
   * Nothing here is a delete, and nothing here re-dates a row. A class that comes back after a
   * holiday is the same row with the flag lifted, because the register underneath it belongs to
   * that class and not to a new one wearing its time.
   */
  async reconcileTeacher(teacherUserId: string, now: Date): Promise<number> {
    const to = new Date(now.getTime() + OCCURRENCE_HORIZON_DAYS * MS_PER_DAY);
    const horizon = { from: now, to };

    const zone = await this.occurrences.teacherZone(teacherUserId);
    const series = await this.occurrences.listSeriesForTeacher(teacherUserId);
    const holidays = await this.calendar.listHolidays(teacherUserId);

    const expected = new Map<string, NewOccurrence>();
    for (const row of series) {
      const pattern: SeriesPattern = {
        weekday: row.weekday,
        startMinutes: row.startMinutes,
        endMinutes: row.endMinutes,
        durationMinutes: row.durationMinutes,
        isActive: row.isActive,
      };
      for (const slot of expandSeries(pattern, zone, horizon, holidays)) {
        expected.set(instantKey(row.id, slot.startsAt), {
          seriesId: row.id,
          courseId: row.courseId,
          teacherUserId,
          startsAt: slot.startsAt,
          durationMinutes: row.durationMinutes,
        });
      }
    }

    const existing = await this.occurrences.listOccurrencesBetween(teacherUserId, now, to);
    const open = [...expected.values()].filter(
      (row) =>
        !existing.some(
          (found) =>
            instantKey(found.seriesId, found.startsAt) === instantKey(row.seriesId, row.startsAt),
        ),
    );
    const reopen = existing
      .filter((row) => !row.isActive && expected.has(instantKey(row.seriesId, row.startsAt)))
      .map((row) => row.id);
    const close = existing
      .filter((row) => row.isActive && !expected.has(instantKey(row.seriesId, row.startsAt)))
      .map((row) => row.id);

    let changed = await this.occurrences.createOccurrences(open);
    changed += await this.occurrences.setOccurrencesActive(reopen, true);
    changed += await this.occurrences.setOccurrencesActive(close, false);

    // Read the horizon again: the rows just written have no ids in this process's hands, and a
    // register has to be written against the classes that actually stand now rather than the ones
    // this run intended to make stand.
    const standing = await this.occurrences.listOccurrencesBetween(teacherUserId, now, to);
    const live = standing.filter((row) => row.isActive);
    changed += await this.reconcileRegisters(live);
    return changed;
  }

  /**
   * Bring each class's register to say exactly the names holding a place in its course.
   *
   * Three writes and no judgement about history: a line is added for a student the sweep has not
   * met, lifted for one who came back, and closed for one who left. All three are confined to the
   * classes the caller handed over — the forward horizon — so a mark made on a class that already
   * happened is untouched by anybody's later leave.
   */
  private async reconcileRegisters(live: Array<{ id: string; courseId: string }>): Promise<number> {
    if (live.length === 0) return 0;

    const courseIds = [...new Set(live.map((row) => row.courseId))];
    const places = new Map<string, Set<string>>();
    for (const courseId of courseIds) {
      places.set(courseId, new Set(await this.enrollments.listActiveStudentIds(courseId)));
    }

    const courseOf = new Map(live.map((row) => [row.id, row.courseId]));
    const lines = await this.occurrences.listSheetRows(live.map((row) => row.id));
    const held = (line: { occurrenceId: string; studentUserId: string }) =>
      places.get(courseOf.get(line.occurrenceId) ?? '')?.has(line.studentUserId) === true;

    const written = new Set(lines.map((line) => lineKey(line.occurrenceId, line.studentUserId)));
    const toWrite: Array<{ occurrenceId: string; studentUserId: string }> = [];
    for (const occurrence of live) {
      for (const studentUserId of places.get(occurrence.courseId) ?? []) {
        if (!written.has(lineKey(occurrence.id, studentUserId))) {
          toWrite.push({ occurrenceId: occurrence.id, studentUserId });
        }
      }
    }

    const changed = await this.occurrences.createSheetRows(toWrite);
    return (
      changed +
      (await this.occurrences.setSheetRowsActive(
        lines.filter((line) => !line.isActive && held(line)).map((line) => line.id),
        true,
      )) +
      (await this.occurrences.setSheetRowsActive(
        lines.filter((line) => line.isActive && !held(line)).map((line) => line.id),
        false,
      ))
    );
  }

  /**
   * The classes this teacher teaches, in the window they asked for.
   *
   * Read straight off the rows rather than recomputed from the patterns, which is the point of the
   * sweep existing: a teacher's week is a list of dated things that include the ones they wrote by
   * hand and exclude the days they closed, and only the table holds both decisions.
   */
  async teaching(
    teacherUserId: string,
    query: ListClassesQueryDto,
    now = new Date(),
  ): Promise<TeachingClassesResponse> {
    const { from, to } = windowOf(query, now);
    const rows = await this.occurrences.listTeaching(teacherUserId, from, to);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      items: rows.map<ScheduledClass>((row) => ({
        id: row.id,
        seriesId: row.seriesId,
        course: row.course,
        startsAt: row.startsAt.toISOString(),
        endsAt: new Date(
          row.startsAt.getTime() + row.durationMinutes * MS_PER_MINUTE,
        ).toISOString(),
        durationMinutes: row.durationMinutes,
        studentsExpected: row.attendances.length,
      })),
    };
  }

  /**
   * The classes this student is standing for, in the window they asked for.
   *
   * Their own mark travels with each row as a code or a null, which is the whole of the attendance
   * story from the person's side: a class that has not been answered reads as nothing rather than
   * as a word the platform invented for it.
   */
  async learning(
    studentUserId: string,
    query: ListClassesQueryDto,
    now = new Date(),
  ): Promise<LearningClassesResponse> {
    const { from, to } = windowOf(query, now);
    const rows = await this.occurrences.listLearning(studentUserId, from, to);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      items: rows.map<AssignedClass>((row) => ({
        id: row.id,
        course: row.course,
        startsAt: row.startsAt.toISOString(),
        endsAt: new Date(
          row.startsAt.getTime() + row.durationMinutes * MS_PER_MINUTE,
        ).toISOString(),
        durationMinutes: row.durationMinutes,
        // The lookup column is text to Prisma and a code to everybody else. The line is only ever
        // marked with one of the seeded attendance values, so the cast says what the write proved.
        status: (row.attendances[0]?.status?.code ?? null) as AttendanceStatusCode | null,
      })),
    };
  }
}

/** The pair that makes a dated class the same one twice: the pattern and the instant. */
function instantKey(seriesId: string, startsAt: Date): string {
  return `${seriesId}|${startsAt.toISOString()}`;
}

/** The pair a register line is keyed by: the class and the person. */
function lineKey(occurrenceId: string, studentUserId: string): string {
  return `${occurrenceId}|${studentUserId}`;
}

/**
 * The stretch a list covers, defaulting to the horizon the sweep keeps.
 *
 * The caller's bounds are returned as written when they were given: a screen that asked for a week
 * is shown the week it asked for, and one that asked for nothing is shown the month the platform
 * still stands behind. A window that ends before it starts is not an error worth a status code —
 * it is an empty list, and the two bounds say so.
 *
 * A window wider than the horizon is refused rather than answered. The rows do not exist that far
 * ahead, so the ask brings no more calendar — only every class this caller owns in one response.
 */
function windowOf(query: ListClassesQueryDto, now: Date): { from: Date; to: Date } {
  const from = query.from ? new Date(query.from) : now;
  const to = query.to
    ? new Date(query.to)
    : new Date(now.getTime() + OCCURRENCE_HORIZON_DAYS * MS_PER_DAY);
  if (to.getTime() - from.getTime() > OCCURRENCE_HORIZON_DAYS * MS_PER_DAY) {
    throw new BadRequestException(
      `A class window may not be wider than ${OCCURRENCE_HORIZON_DAYS} days.`,
    );
  }
  return { from, to };
}
