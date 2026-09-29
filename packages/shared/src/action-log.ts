/**
 * The actions this platform records, and the shape each one has.
 *
 * Phase 7's table is a row of text columns that believe whatever writes them, so this file is the
 * only place a made-up action, a section no route belongs to, or a target that no table answers to
 * can be caught. That is the same division `mail_outbox` and `MAIL_EVENT_CODES` arrived at in
 * Phase 6: the list of what may be written lives next to the code that writes it, not in a constraint
 * a database would enforce more weakly than the vocabulary does.
 *
 * Three halves of a row's shape are derived from the action code rather than passed by the caller —
 * which part of the app it happened in, which table it was about, and whether a person or the
 * scheduler did it — for the reason 6d gave for naming the event in the service rather than leaving
 * the repository to guess: the caller already knows which decision it is recording, and asking it to
 * also name the room that decision happened in and who was holding the mouse is three more chances
 * to be wrong about a fact that follows from the first one. `ACTION_SHAPES` is where those answers
 * are written once, and `satisfies Record<ActionCode, …>` is what makes a new action impossible to
 * add without giving it all three.
 */

/** The parts of the app an action can come from. */
export const ACTION_SECTION_CODES = {
  /** Signing up, signing in, signing out, and the replay that ends every session an account has. */
  ACCOUNT: 'account',
  /** The teacher's own public page — the one write a profile has. */
  TEACHER_PROFILE: 'teacher_profile',
  /** The syllabus editor: a course, the modules inside it and the lessons inside those. Three
   * controllers, one screen a teacher is standing on. */
  COURSE_AUTHORING: 'course_authoring',
  /** A recording attached to a lesson, which goes through the storage port rather than the
   * database alone, and is the one authoring action with a file behind it. */
  LESSON_MEDIA: 'lesson_media',
  /** The weekly windows a teacher keeps open. */
  AVAILABILITY: 'availability',
  /** A place in a course taken or left. */
  ENROLLMENT: 'enrollment',
  /** A minute of a teacher's week asked for, answered, given back, or run out. */
  BOOKING: 'booking',
} as const;

export type ActionSectionCode = (typeof ACTION_SECTION_CODES)[keyof typeof ACTION_SECTION_CODES];

/** The tables an action can be about, named as `@@map` names them. */
export const ACTION_TARGET_TABLE_CODES = {
  USERS: 'users',
  TEACHER_PROFILE: 'teacher_profile',
  COURSE: 'course',
  MODULE: 'module',
  LESSON: 'lesson',
  LESSON_ASSET: 'lesson_asset',
  AVAILABILITY_RULE: 'availability_rule',
  ENROLLMENT: 'enrollment',
  BOOKING: 'booking',
} as const;

export type ActionTargetTableCode =
  (typeof ACTION_TARGET_TABLE_CODES)[keyof typeof ACTION_TARGET_TABLE_CODES];

/** Whether a person or the scheduler wrote the row. Two words, and the second one is what keeps a
 * machine's work from being recorded with a person's id invented for it. */
export const ACTION_ACTOR_KIND_CODES = {
  USER: 'user',
  SYSTEM: 'system',
} as const;

export type ActionActorKindCode =
  (typeof ACTION_ACTOR_KIND_CODES)[keyof typeof ACTION_ACTOR_KIND_CODES];

/**
 * The decisions worth a row: every write that changed something, and the three account events a
 * person later asks about.
 *
 * The seven class and place codes are the same strings `MAIL_EVENT_CODES` uses, on purpose. One
 * decision, one name, whether it is read out of the queue that mailed it or out of the log that
 * recorded it — and the sends and the writes are the same seven, so the two lists can be asserted
 * equal rather than merely compatible.
 *
 * What is not here is as deliberate as what is: no token rotation (every portal load does one, and
 * `refresh_token` already holds the record), no mail queue status (the queue _is_ that record), and
 * no read of any kind — a refusal, a 404 or a gate that said no changed nothing, and the access log
 * already has the request.
 */
export const ACTION_CODES = {
  ACCOUNT_REGISTERED: 'account_registered',
  SIGNED_IN: 'signed_in',
  SIGNED_OUT: 'signed_out',
  /** §7: a retired refresh token presented twice ends every session the account has. That is the
   * system doing something to an account on the strength of a security finding, and the one auth
   * event a person would want explained to them. */
  SESSION_REPLAY_DETECTED: 'session_replay_detected',

  TEACHER_PROFILE_SAVED: 'teacher_profile_saved',

  COURSE_CREATED: 'course_created',
  COURSE_UPDATED: 'course_updated',
  COURSE_PUBLISHED: 'course_published',
  COURSE_ARCHIVED: 'course_archived',
  /** One code for both directions, because the route is one switch and the decided fact — which way
   * it went — is in `detail`. */
  COURSE_DEMO_BOOKINGS_CHANGED: 'course_demo_bookings_changed',
  COURSE_MODULE_CREATED: 'course_module_created',
  COURSE_MODULE_UPDATED: 'course_module_updated',
  COURSE_MODULE_DEACTIVATED: 'course_module_deactivated',
  COURSE_MODULES_REORDERED: 'course_modules_reordered',
  LESSON_CREATED: 'lesson_created',
  LESSON_UPDATED: 'lesson_updated',
  LESSON_PUBLISHED: 'lesson_published',
  LESSON_UNPUBLISHED: 'lesson_unpublished',
  LESSON_DEACTIVATED: 'lesson_deactivated',
  LESSONS_REORDERED: 'lessons_reordered',

  LESSON_ASSET_ATTACHED: 'lesson_asset_attached',

  AVAILABILITY_RULE_CREATED: 'availability_rule_created',
  AVAILABILITY_RULE_UPDATED: 'availability_rule_updated',
  AVAILABILITY_RULE_RETIRED: 'availability_rule_retired',

  ENROLLMENT_JOINED: 'enrollment_joined',
  ENROLLMENT_LEFT: 'enrollment_left',

  BOOKING_REQUESTED: 'booking_requested',
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_REFUSED: 'booking_refused',
  BOOKING_CANCELLED: 'booking_cancelled',
  BOOKING_EXPIRED: 'booking_expired',
} as const;

export type ActionCode = (typeof ACTION_CODES)[keyof typeof ACTION_CODES];

export interface ActionShape {
  section: ActionSectionCode;
  targetTable: ActionTargetTableCode;
  actorKind: ActionActorKindCode;
}

/**
 * Where each action happened, what it touched, and who was capable of doing it.
 *
 * Two of the answers are worth their own comment, because both are a choice between two plausible
 * rows to name:
 *
 * - A **reorder is about the thing that was holding the list**, not the rows that moved. Reordering
 *   a course's modules is a decision about the course; the individual rows' new positions are
 *   already readable from those rows, and naming one of them as the target would point at whichever
 *   happened to land first.
 * - An **account event is about the account**, never about a `refresh_token` row. The token is
 *   retired and replaced on every portal load, while the question a person asks later is what
 *   happened to their account.
 *
 * `signed_in`, `signed_out` and `account_registered` are `user` actions even though the first two
 * have nobody signed in yet: the account the event is about is the actor, and naming it is what
 * makes the row answer "when was this account last used".
 */
export const ACTION_SHAPES = {
  account_registered: {
    section: ACTION_SECTION_CODES.ACCOUNT,
    targetTable: ACTION_TARGET_TABLE_CODES.USERS,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  signed_in: {
    section: ACTION_SECTION_CODES.ACCOUNT,
    targetTable: ACTION_TARGET_TABLE_CODES.USERS,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  signed_out: {
    section: ACTION_SECTION_CODES.ACCOUNT,
    targetTable: ACTION_TARGET_TABLE_CODES.USERS,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  session_replay_detected: {
    section: ACTION_SECTION_CODES.ACCOUNT,
    targetTable: ACTION_TARGET_TABLE_CODES.USERS,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },

  teacher_profile_saved: {
    section: ACTION_SECTION_CODES.TEACHER_PROFILE,
    targetTable: ACTION_TARGET_TABLE_CODES.TEACHER_PROFILE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },

  course_created: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  course_updated: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  course_published: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  course_archived: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  course_demo_bookings_changed: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  course_module_created: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.MODULE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  course_module_updated: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.MODULE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  course_module_deactivated: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.MODULE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  course_modules_reordered: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  lesson_created: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.LESSON,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  lesson_updated: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.LESSON,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  lesson_published: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.LESSON,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  lesson_unpublished: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.LESSON,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  lesson_deactivated: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.LESSON,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  lessons_reordered: {
    section: ACTION_SECTION_CODES.COURSE_AUTHORING,
    targetTable: ACTION_TARGET_TABLE_CODES.MODULE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },

  lesson_asset_attached: {
    section: ACTION_SECTION_CODES.LESSON_MEDIA,
    targetTable: ACTION_TARGET_TABLE_CODES.LESSON_ASSET,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },

  availability_rule_created: {
    section: ACTION_SECTION_CODES.AVAILABILITY,
    targetTable: ACTION_TARGET_TABLE_CODES.AVAILABILITY_RULE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  availability_rule_updated: {
    section: ACTION_SECTION_CODES.AVAILABILITY,
    targetTable: ACTION_TARGET_TABLE_CODES.AVAILABILITY_RULE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  availability_rule_retired: {
    section: ACTION_SECTION_CODES.AVAILABILITY,
    targetTable: ACTION_TARGET_TABLE_CODES.AVAILABILITY_RULE,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },

  enrollment_joined: {
    section: ACTION_SECTION_CODES.ENROLLMENT,
    targetTable: ACTION_TARGET_TABLE_CODES.ENROLLMENT,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  enrollment_left: {
    section: ACTION_SECTION_CODES.ENROLLMENT,
    targetTable: ACTION_TARGET_TABLE_CODES.ENROLLMENT,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },

  booking_requested: {
    section: ACTION_SECTION_CODES.BOOKING,
    targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  booking_confirmed: {
    section: ACTION_SECTION_CODES.BOOKING,
    targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  booking_refused: {
    section: ACTION_SECTION_CODES.BOOKING,
    targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  booking_cancelled: {
    section: ACTION_SECTION_CODES.BOOKING,
    targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
    actorKind: ACTION_ACTOR_KIND_CODES.USER,
  },
  /** The only action nobody is asked to believe a person took: this one is written by the sweep that
   * lets an unanswered request go, on a clock rather than on a decision. */
  booking_expired: {
    section: ACTION_SECTION_CODES.BOOKING,
    targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
    actorKind: ACTION_ACTOR_KIND_CODES.SYSTEM,
  },
} as const satisfies Record<ActionCode, ActionShape>;

/**
 * The actions with no human behind them, read off the shapes above rather than declared twice.
 *
 * One member today, and the list is worth having by name because it is the answer to a question an
 * operator asks of any log: how much of this was the machine. A future scheduler-driven write joins
 * this by changing its own shape, not by inventing a way to say `system` at a call site.
 */
export const SYSTEM_ACTION_CODES: readonly ActionCode[] = Object.entries(ACTION_SHAPES)
  .filter(([, shape]) => shape.actorKind === ACTION_ACTOR_KIND_CODES.SYSTEM)
  .map(([code]) => code as ActionCode);

/**
 * The three derived halves of a row, from the one code a caller names.
 *
 * Throws rather than answering with an empty section: a row filed under a part of the app nobody
 * declared would be a record that reads as though the vocabulary had a gap in it, and the caller is
 * about to find out in its own spec. The message names the code, which is our own word rather than
 * something a client sent us.
 */
export function actionShapeFor(action: string): ActionShape {
  const shape = (ACTION_SHAPES as Readonly<Record<string, ActionShape | undefined>>)[action];
  if (!shape) {
    throw new Error(`No action-log shape declared for ${action}`);
  }
  return shape;
}

/** One decided fact. A string, a number or a boolean, and nothing with parts.
 *
 * This sits with the vocabulary rather than beside the writer because the column has one shape for
 * both directions: what a write may file and what a reader is handed are the same promise, and two
 * definitions of it would be free to disagree. The flatness is 7a's rule — the decided facts, never
 * a copy of the row the action touched — and an object is what a snapshot would have to be, so
 * `detail: { course }` does not compile here either. */
export type ActionDetailValue = string | number | boolean;
export type ActionDetail = Record<string, ActionDetailValue>;

/** The person the row credits, as the read side answers it.
 *
 * A name and an id, which is the same line the teacher's roster draws: an email address never
 * arrives here, because a log row outlives both the correction a person makes to their account and
 * the deletion they ask for, and an address in a ledger is an address kept forever.
 *
 * `roleCode` is the role as the row stored it — what this person was allowed to do at the time — so
 * a promotion does not rewrite what they did before it. Their current role is readable from the
 * account, and is a different question. It is null only on a row written with no role to read, which
 * the recorder reports rather than invents. */
export interface ActionLogActor {
  id: string;
  fullName: string;
  roleCode: string | null;
}

/**
 * One row of the ledger, read.
 *
 * Nine answers and no translation: the columns are named what `action_log` names them, so a person
 * comparing a row here with the table it came from is not reconciling two vocabularies. Two of them
 * are worth saying why they are here at all:
 *
 * - `requestId` is the link to the access-log line of the same name, and it is null for a
 *   scheduler's work because a sweep has no request to point back to.
 * - `actor` is null in exactly those rows, and only there — the split an operator reads as
 *   "how much of this was the machine".
 *
 * `targetId` is a uuid with no promise it still resolves, which is the point of keeping the record:
 * a course archived next year was published in September, and the row says so either way.
 */
export interface ActionLogEntry {
  id: string;
  actionCode: ActionCode;
  sectionCode: ActionSectionCode;
  actorKind: ActionActorKindCode;
  targetTable: ActionTargetTableCode;
  targetId: string;
  detail: ActionDetail;
  actor: ActionLogActor | null;
  requestId: string | null;
  /** When the action happened, as the transaction that wrote it timed it — UTC on the wire, and the
   * portal that draws it decides the zone it shows. */
  createdAt: string;
}

/** A page of the log, newest first. `total` counts everything the filters matched, not the rows on
 * this page, which is what lets a screen say "412 sign-ins" rather than "25". */
export interface ActionListResponse {
  items: ActionLogEntry[];
  page: number;
  pageSize: number;
  total: number;
}
