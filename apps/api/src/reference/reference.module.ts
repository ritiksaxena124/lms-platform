import { Global, Module } from '@nestjs/common';

import { ReferenceService } from './reference.service';

/** Global because nearly every module writes a row that points at a lookup value, and
 * none of them should have to import this to do it. */
@Global()
@Module({
  providers: [ReferenceService],
  exports: [ReferenceService],
})
export class ReferenceModule {}
