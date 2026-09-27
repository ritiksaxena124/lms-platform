import { Injectable } from '@nestjs/common';

import type { Video, VideoRoom } from './video.port';

/**
 * A deployment with no live video, which is a thing people run rather than a TODO.
 *
 * The alternative to this class is an `if (provider === 'none')` in every route that could show
 * a Join button, and those `if`s drift: one screen learns to hide the button and the next one
 * does not, and a student is offered a room that was never going to exist. Putting the answer on
 * the port means the only question a caller can ask — "where is this class held?" — has the same
 * shape on every deployment and a boring answer here.
 *
 * Note what is *not* changed: an uploaded lesson still plays, because that is the storage port
 * (§6) and has nothing to do with this one. A `none` box loses live classes only.
 */
@Injectable()
export class NoVideo implements Video {
  room(_name: string): VideoRoom | null {
    return null;
  }
}
