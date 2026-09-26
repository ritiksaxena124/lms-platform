import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

/**
 * Discovery, kept away from the authoring module on purpose.
 *
 * `CourseModule` answers "what may this teacher change about their own course?"; this
 * answers "what may anybody read of a course that is finished?" Those questions agree on a
 * table and on nothing else — one resolves ownership against a session, the other has no
 * session — and a single service that did both would eventually be a file of `if (isStudent)`
 * branches around someone else's rules. The published statuses are the only shared knowledge
 * here, and they are read from the same reference rows either way.
 *
 * There are no writes in this module, and adding one would be the signal that it has grown
 * into a second authoring surface rather than a catalog.
 */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CatalogRepository],
})
export class CatalogModule {}
