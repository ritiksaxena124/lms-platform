import { describe, expect, it } from 'vitest';

import { MAIL_EVENT_CODES } from './mail-events';

import {
  ACTION_ACTOR_KIND_CODES,
  ACTION_CODES,
  ACTION_SECTION_CODES,
  ACTION_TARGET_TABLE_CODES,
  SYSTEM_ACTION_CODES,
  actionShapeFor,
} from './action-log';

/**
 * The vocabulary is the whole of Phase 7's data model, because the table under it deliberately
 * states nothing: `action_log` takes any string in any column, exactly as `mail_outbox` does. So
 * the only place a made-up action, a section no route belongs to, or a target that no table answers
 * to can be caught is this file.
 *
 * Three lists are derived from one code rather than passed by the caller — the section, the target
 * table and whether a human did it — for the reason 6d gave for putting the event name in the
 * service rather than the repository: the caller already knows which decision it is recording, and
 * asking it to also name the room that decision happened in, and the table it touched, and who was
 * holding the mouse, is three more chances to be wrong about the same fact.
 */
describe('the action vocabulary', () => {
  it('names the parts of the app an action can come from, and nothing a writer invented', () => {
    expect(Object.values(ACTION_SECTION_CODES).sort()).toEqual([
      'account',
      'availability',
      'booking',
      'course_authoring',
      'enrollment',
      'lesson_media',
      'teacher_profile',
    ]);
  });

  it('names the tables an action can be about, by the name the database gives them', () => {
    // `users` rather than `user`, and `module` rather than `course_module`, because a reader of a
    // log row goes to the table these words name. A second, friendlier vocabulary for the same
    // rows would be the drift this system keeps to one API.
    expect(Object.values(ACTION_TARGET_TABLE_CODES).sort()).toEqual([
      'availability_rule',
      'booking',
      'course',
      'enrollment',
      'lesson',
      'lesson_asset',
      'module',
      'teacher_profile',
      'users',
    ]);
  });

  it('lists every action, and gives each one a section, a target and an actor kind', () => {
    const codes = Object.values(ACTION_CODES);
    expect(codes.length).toBe(new Set(codes).size);

    // One assertion doing the work of three lists: every code answers with all three halves of its
    // shape, so no action can be added without saying where it happened, what it touched and who
    // was holding the mouse.
    for (const code of codes) {
      const shape = actionShapeFor(code);
      expect(Object.values(ACTION_SECTION_CODES)).toContain(shape.section);
      expect(Object.values(ACTION_TARGET_TABLE_CODES)).toContain(shape.targetTable);
      expect(Object.values(ACTION_ACTOR_KIND_CODES)).toContain(shape.actorKind);
    }
  });

  it('keeps every section reachable, and holds the syllabus together', () => {
    // A section no action names is a part of the app the read side would filter to nothing. And
    // `course_authoring` deliberately carries the course, its modules and its lessons: three
    // controllers, one screen a teacher is standing on.
    const sectionsUsed = new Set(
      Object.values(ACTION_CODES).map((code) => actionShapeFor(code).section),
    );
    expect(sectionsUsed).toEqual(new Set(Object.values(ACTION_SECTION_CODES)));
    expect(
      Object.values(ACTION_CODES).filter(
        (code) => actionShapeFor(code).section === ACTION_SECTION_CODES.COURSE_AUTHORING,
      ),
    ).toContain(ACTION_CODES.LESSON_PUBLISHED);
  });

  it('says which actions no person did', () => {
    // The only writer in this system with no human behind it today is the sweep that lets an
    // unanswered request go. `signed_in` is not one of them even though nobody was signed in when
    // it happened — the account the event is about is the actor, and naming it is what makes the
    // row answer "when was this account last used".
    expect(SYSTEM_ACTION_CODES).toEqual([ACTION_CODES.BOOKING_EXPIRED]);
    expect(actionShapeFor(ACTION_CODES.BOOKING_EXPIRED).actorKind).toBe(
      ACTION_ACTOR_KIND_CODES.SYSTEM,
    );
    expect(actionShapeFor(ACTION_CODES.SIGNED_IN).actorKind).toBe(ACTION_ACTOR_KIND_CODES.USER);
    expect(actionShapeFor(ACTION_CODES.COURSE_PUBLISHED).actorKind).toBe(
      ACTION_ACTOR_KIND_CODES.USER,
    );
  });

  it('keeps two actor kinds apart, and gives a machine no name to be wrong about', () => {
    expect(Object.values(ACTION_ACTOR_KIND_CODES).sort()).toEqual(['system', 'user']);
  });

  it('says what a reorder is about: the thing that was holding the list', () => {
    // Not the rows that moved. A module list reordered is a decision about the course, and the
    // individual rows' new positions are already readable from those rows; naming one of them as
    // the target would be a record pointing at whichever happened to be first.
    expect(actionShapeFor(ACTION_CODES.COURSE_MODULES_REORDERED).targetTable).toBe(
      ACTION_TARGET_TABLE_CODES.COURSE,
    );
    expect(actionShapeFor(ACTION_CODES.LESSONS_REORDERED).targetTable).toBe(
      ACTION_TARGET_TABLE_CODES.MODULE,
    );
  });

  it('names the account events about the account, not about a session row', () => {
    // A `refresh_token` row would be the tempting target, and it is the wrong one: the token is
    // retired and replaced on every portal load, while the fact a person asks about later is what
    // happened to *their account*.
    expect(actionShapeFor(ACTION_CODES.SIGNED_IN).targetTable).toBe(
      ACTION_TARGET_TABLE_CODES.USERS,
    );
    expect(actionShapeFor(ACTION_CODES.ACCOUNT_REGISTERED).targetTable).toBe(
      ACTION_TARGET_TABLE_CODES.USERS,
    );
    expect(actionShapeFor(ACTION_CODES.SESSION_REPLAY_DETECTED).targetTable).toBe(
      ACTION_TARGET_TABLE_CODES.USERS,
    );
  });

  it('shares its seven class and place words with the queue that mails about them', () => {
    // One decision, one name, whether it is read out of `mail_outbox.event_code` or out of
    // `action_log.action_code`. Two vocabularies for the same seven events would be a reconciliation
    // job for anybody comparing a letter with the record of the change that caused it — and the
    // sends and the writes are the same seven decisions, which is why this assertion can be exact
    // rather than a subset.
    const shared = [
      ACTION_CODES.BOOKING_REQUESTED,
      ACTION_CODES.BOOKING_CONFIRMED,
      ACTION_CODES.BOOKING_REFUSED,
      ACTION_CODES.BOOKING_CANCELLED,
      ACTION_CODES.BOOKING_EXPIRED,
      ACTION_CODES.ENROLLMENT_JOINED,
      ACTION_CODES.ENROLLMENT_LEFT,
    ];
    expect(new Set(shared)).toEqual(new Set(Object.values(MAIL_EVENT_CODES)));
  });

  it('refuses an action nobody declared, rather than recording it under no part at all', () => {
    // The recorder calls this before it writes, so a caller that invented a code gets an error in
    // its own spec rather than a row whose section column would have had to be guessed. The message
    // names the code, which is our own vocabulary and never a value somebody typed in.
    expect(() => actionShapeFor('invented_by_a_test')).toThrow(/invented_by_a_test/);
    expect(() => actionShapeFor('')).toThrow();
  });
});
