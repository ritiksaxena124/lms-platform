import { Injectable } from '@nestjs/common';
import type { ActionLog, Prisma } from '@prisma/client';
import {
  ACTION_ACTOR_KIND_CODES,
  ACTION_SECTION_CODES,
  actionShapeFor,
  type ActionCode,
  type ActionShape,
  type RoleCode,
} from '@lms/shared';

import { currentLogContext } from '../../common/logging/log-context';

/** One decided fact. A string, a number or a boolean, and nothing with parts.
 *
 * The flatness is the rule 7a wrote down about `detail` — the decided facts, never a copy of the row
 * the action touched — enforced where a caller will meet it. A snapshot is an object, so
 * `detail: course` does not compile, and a room name or a token has to be deliberately named as a
 * fact to arrive here at all. */
export type ActionDetailValue = string | number | boolean;
export type ActionDetail = Record<string, ActionDetailValue>;

/** What a write decides to record: which action, which row, and what was settled.
 *
 * Three fields, and that is the whole surface. The section, the target table and whether a person or
 * the scheduler did it are not here because `ACTION_SHAPES` already answers them for every code —
 * asking a route to repeat them would be three chances per call site to disagree with the action it
 * just named. */
export interface ActionInput {
  action: ActionCode;
  targetId: string;
  detail?: ActionDetail;
}

/** The person an action is credited to, when the request cannot say it. See `recordAs`. */
export interface ActionActor {
  userId: string;
  userRole: RoleCode;
}

/**
 * Files the record of a decision beside the decision.
 *
 * **It has no Prisma client of its own**, for 6d's reason about the mail queue restated for a table
 * that matters more: the row is written with the transaction that made the change, so a write that
 * rolls back leaves no record of it, and a record cannot be filed for a change that never happened.
 * Every method takes the caller's `Prisma.TransactionClient`, and a caller outside a transaction
 * has to open one — which is the same awkwardness that keeps the ordering honest.
 *
 * **The actor is read from the request, not from the caller.** `record` takes the account and the
 * role from the context the middleware opened and `JwtAuthGuard` filled, and the request id from the
 * same place, so the row is a statement about what the server resolved rather than about what a
 * route chose to say. A route that could name its own actor would be in charge of the one answer the
 * log exists to give, and `x-request-id` is a header a client sets.
 *
 * **A person's action with no person in the request is refused.** The alternative is a row saying
 * *somebody published this course and we do not know who*, filed at the moment a route was wired up
 * wrongly — and a log with rows like that in it cannot be trusted for the ones without an actor,
 * which are the ones that matter. `recordAs` is the exception, and it is confined to the account
 * section for the reason given there.
 *
 * Adding a row is cheap enough that no call site should think about it. What it is not is a place
 * for a status: the row says what was decided, and never whether the decision turned out well.
 */
@Injectable()
export class ActionRecorder {
  async record(tx: Prisma.TransactionClient, input: ActionInput): Promise<ActionLog> {
    const shape = actionShapeFor(input.action);
    const { requestId, userId, userRole } = currentLogContext();

    if (shape.actorKind === ACTION_ACTOR_KIND_CODES.SYSTEM) {
      // Nobody's work, whoever happens to be waiting for it. A sweep can be reached by a request as
      // easily as by the clock, and crediting the waiter would make the row's own `actor_kind` a lie.
      return this.file(tx, input, shape, { userId: null, roleCode: null }, requestId ?? null);
    }

    if (!userId) {
      throw new Error(
        `Cannot record ${input.action}: a person's action names nobody, and no session was resolved for this request.`,
      );
    }
    return this.file(tx, input, shape, { userId, roleCode: userRole ?? null }, requestId ?? null);
  }

  /** Name the account the action is credited to, rather than reading it from the request.
   *
   * The four account events are person-actions with no session behind them: on `/auth/register` the
   * account does not exist until the transaction writes it, and on `/auth/login` nobody has signed
   * in yet — the guard has already returned for a public route. So the caller, which has just
   * loaded or created the row, names the actor. It is the same account the row is about, which is
   * why a call site passes the id twice.
   *
   * Confined to the `account` section on purpose. Everywhere else this would be a way for one route
   * to file an action against a person who was never asking — the exact failure the actor column
   * exists to make impossible. The confinement is not theoretical: every `/auth/*` route is
   * `@Public()`, so the guard resolves nobody there and returns, and the three routes that do
   * resolve a session without demanding one (`@OptionalSession()`, all catalog reads) never write a
   * standing row. The account events are therefore genuinely the only user actions that arrive with
   * nobody in the request, and 7c-3 files all four of them through this door.
   */
  async recordAs(
    actor: ActionActor,
    tx: Prisma.TransactionClient,
    input: ActionInput,
  ): Promise<ActionLog> {
    const shape = actionShapeFor(input.action);
    if (shape.section !== ACTION_SECTION_CODES.ACCOUNT) {
      throw new Error(
        `Cannot name an actor for ${input.action}: only account actions have no session to read one from.`,
      );
    }
    const { requestId } = currentLogContext();
    return this.file(
      tx,
      input,
      shape,
      { userId: actor.userId, roleCode: actor.userRole },
      requestId ?? null,
    );
  }

  private async file(
    tx: Prisma.TransactionClient,
    input: ActionInput,
    shape: ActionShape,
    actor: { userId: string | null; roleCode: string | null },
    requestId: string | null,
  ): Promise<ActionLog> {
    // Nine keys and no `id`, no `createdAt`: the database issues both, and a recorder that stamped
    // its own instant would be a record whose clock is the process that wrote it rather than the
    // transaction the change committed in.
    return tx.actionLog.create({
      data: {
        actionCode: input.action,
        sectionCode: shape.section,
        actorKind: shape.actorKind,
        targetTable: shape.targetTable,
        targetId: input.targetId,
        detail: input.detail ?? {},
        actorUserId: actor.userId,
        actorRoleCode: actor.roleCode,
        requestId,
      },
    });
  }
}
