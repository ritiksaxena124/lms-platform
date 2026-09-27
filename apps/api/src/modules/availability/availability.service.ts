import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { API_ERROR_CODES, wallClock, weekdayLabel, type AvailabilityRule } from '@lms/shared';

import {
  AvailabilityRepository,
  type AvailabilityRow,
  type RuleWindow,
} from './availability.repository';
import type {
  CreateAvailabilityRuleDto,
  UpdateAvailabilityRuleDto,
} from './dto/availability-rule.dto';

function toDocument(rule: AvailabilityRow): AvailabilityRule {
  return {
    id: rule.id,
    weekday: rule.weekday,
    startMinutes: rule.startMinutes,
    endMinutes: rule.endMinutes,
    slotMinutes: rule.slotMinutes,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Check the highlighted fields.',
    details: { validation: { [field]: [message] } },
  });
}

/** A window in the way of another one. Reported against the opening minute, because that is the
 * box the teacher was typing in when they ran into it. */
function overlap(clash: RuleWindow): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'Check the highlighted fields.',
    details: {
      validation: {
        startMinutes: [
          `${weekdayLabel(clash.weekday)} ${wallClock(clash.startMinutes)}–${wallClock(
            clash.endMinutes,
          )} already has a window in it. This one has to open after that one closes.`,
        ],
      },
    },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A teacher's week, and the only place a window is decided to be one.
 *
 * The columns accept anything numeric — `availability-schema.spec.ts` holds that line on
 * purpose — so the three rules that make a window a window are here: it closes after it opens, a
 * class fits inside it, and no two of them cover the same minute. All three are questions about
 * a set of rows or about the four numbers together, and neither is something a field-level check
 * on a DTO could answer.
 *
 * Ownership is answered with `NOT_FOUND`, so a colleague probing ids learns nothing about whose
 * schedule exists. Retirement is the only exit, and a window set again at a minute that has been
 * used before is the original row brought back rather than a second one competing with it.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly rules: AvailabilityRepository) {}

  async list(teacherUserId: string): Promise<AvailabilityRule[]> {
    return (await this.rules.listActive(teacherUserId)).map(toDocument);
  }

  async create(teacherUserId: string, dto: CreateAvailabilityRuleDto): Promise<AvailabilityRule> {
    const window = this.wellFormed(dto);

    // The row is reopened rather than replaced: one window per opening minute for as long as the
    // account exists, so the teacher who closed Monday 09:00 last month and changed their mind is
    // back to one window on that minute, not two.
    const retired = await this.rules.findRetiredAt(
      teacherUserId,
      window.weekday,
      window.startMinutes,
    );
    await this.requireFree(teacherUserId, window);
    try {
      return toDocument(
        retired
          ? await this.rules.reopen(retired.id, window)
          : await this.rules.open(teacherUserId, window),
      );
    } catch (error) {
      // Two tabs saving the same window: the check above passed for both, and the business key is
      // what caught it. The answer is the one the check would have given.
      throw this.orTakenOnTheMinute(teacherUserId, error, window);
    }
  }

  async update(
    teacherUserId: string,
    id: string,
    dto: UpdateAvailabilityRuleDto,
  ): Promise<AvailabilityRule> {
    const rule = await this.owned(teacherUserId, id);
    const window = this.wellFormed({
      weekday: dto.weekday ?? rule.weekday,
      startMinutes: dto.startMinutes ?? rule.startMinutes,
      endMinutes: dto.endMinutes ?? rule.endMinutes,
      slotMinutes: dto.slotMinutes ?? rule.slotMinutes,
    });

    await this.requireFree(teacherUserId, window, id);
    try {
      return toDocument(await this.rules.rewrite(id, window));
    } catch (error) {
      // The minute this window moved to belongs to a retired row, which the overlap check cannot
      // see because it is not standing. Reopen that one instead.
      throw this.orTakenOnTheMinute(teacherUserId, error, window);
    }
  }

  async retire(teacherUserId: string, id: string): Promise<AvailabilityRule> {
    const rule = await this.owned(teacherUserId, id);

    if (!rule.isActive) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'That window is already retired.',
      });
    }

    return toDocument(await this.rules.retire(id));
  }

  /**
   * The four numbers as one shape, or a refusal naming the field that broke it.
   *
   * `endMinutes` carries the "closes before it opens" answer rather than `startMinutes`, because
   * a teacher who moved an end below a start edited the end. The slot has to fit whole: a
   * ninety-minute class in a sixty-minute window would be a slot the generator could never tile,
   * and 4e has to be able to trust what is stored here.
   */
  private wellFormed(window: RuleWindow): RuleWindow {
    if (window.endMinutes <= window.startMinutes) {
      throw fieldError(
        'endMinutes',
        `A window has to close after it opens, and ${wallClock(window.endMinutes)} is not after ${wallClock(
          window.startMinutes,
        )}.`,
      );
    }

    const length = window.endMinutes - window.startMinutes;
    if (window.slotMinutes > length) {
      throw fieldError(
        'slotMinutes',
        `A ${window.slotMinutes}-minute class does not fit in a ${length}-minute window.`,
      );
    }

    return window;
  }

  /** Nothing standing may cover any minute of this window. A window may touch another one —
   * 09:00–10:00 and 10:00–11:00 are two classes, not a collision. */
  private async requireFree(teacherUserId: string, window: RuleWindow, exceptId?: string) {
    const clash = await this.rules.findOverlap(teacherUserId, window, exceptId);
    if (clash) throw overlap(clash);
  }

  private async orTakenOnTheMinute(teacherUserId: string, error: unknown, window: RuleWindow) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const clash =
      (await this.rules.findOverlap(teacherUserId, window)) ??
      (await this.rules.findRetiredAt(teacherUserId, window.weekday, window.startMinutes));
    if (!clash) throw error;
    throw overlap(clash);
  }

  private async owned(teacherUserId: string, id: string) {
    // Postgres answers a malformed uuid with a syntax error, which would reach the client as a
    // 500 about someone's typo. A uuid that cannot exist is simply not found.
    const rule = UUID.test(id) ? await this.rules.findOwned(teacherUserId, id) : null;
    if (!rule) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that window.',
      });
    }
    return rule;
  }
}
