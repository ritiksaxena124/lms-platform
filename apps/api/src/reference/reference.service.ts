import { Injectable } from '@nestjs/common';
import type { LkpTypeCode } from '@lms/shared';

import { PrismaService } from '../common/prisma/prisma.service';

/** A reference row, narrowed to the three fields anything outside this file may need. */
export interface ReferenceValue {
  id: string;
  code: string;
  label: string;
}

/**
 * Translates between the reference codes the API speaks and the lookup rows the database
 * stores. Domain code never learns a `lkp_value` uuid, and a lookup row never travels
 * further than this file.
 */
@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Id of a reference value. Throws if the code was never seeded — see the note on
   * `LOOKUP_SEEDS` for why that is a boot failure rather than a runtime surprise. */
  async valueId(typeCode: LkpTypeCode, code: string): Promise<string> {
    const value = await this.prisma.lkpValue.findFirst({
      where: { code, type: { code: typeCode } },
    });
    if (!value) {
      throw new Error(`Reference value ${typeCode}/${code} is not seeded`);
    }
    return value.id;
  }

  /**
   * Resolves a handful of codes in one query. Absent from the result means the code is
   * unknown to this type — the caller decides whether that is a 400 (`a subject the
   * catalogue has never heard of`) or a 500 (`a role we forgot to seed`), which this file
   * cannot tell apart.
   */
  async valuesByCodes(typeCode: LkpTypeCode, codes: readonly string[]): Promise<ReferenceValue[]> {
    if (codes.length === 0) return [];
    const rows = await this.prisma.lkpValue.findMany({
      where: { code: { in: [...new Set(codes)] }, type: { code: typeCode }, isActive: true },
      select: { id: true, code: true, label: true },
    });
    return rows;
  }

  /**
   * Everything currently offerable under a type, in the order Ops set it. A picker asks
   * for this instead of keeping its own list, so a value that appears in the database
   * appears in the form without anyone shipping a change.
   */
  async activeValues(typeCode: LkpTypeCode): Promise<ReferenceValue[]> {
    return this.prisma.lkpValue.findMany({
      where: { type: { code: typeCode }, isActive: true },
      select: { id: true, code: true, label: true },
      orderBy: { position: 'asc' },
    });
  }
}
