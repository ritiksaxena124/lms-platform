import { Module } from '@nestjs/common';

import { StorageModule } from '../../providers/storage/storage.module';
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
 *
 * The storage port is here for one read: the recording a page carries, gated by the page's own
 * door. That is not a write and does not make this an authoring module — it is the syllabus
 * arriving with its video, which is the same question (`may this reader have this page?`) asked
 * of a different kind of bytes. The key never leaves this side of the door, and the module that
 * uploaded the file keeps the only pen.
 */
@Module({
  imports: [StorageModule],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogRepository],
})
export class CatalogModule {}
