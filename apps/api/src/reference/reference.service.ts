import { Injectable } from '@nestjs/common';
import type { LkpTypeCode } from '@lms/shared';

import { PrismaService } from '../common/prisma/prisma.service';

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
}
