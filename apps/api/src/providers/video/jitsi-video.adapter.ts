import { Injectable } from '@nestjs/common';

import {
  UnusableVideoDomainError,
  UnsafeRoomNameError,
  type Video,
  type VideoRoom,
} from './video.port';

/** The alphabet a Jitsi room name is allowed to be written in. A uuid fits, a course title
 * does not, and the difference matters: `encodeURI` on a title is still a guessable room. */
const ROOM_NAME = /^[A-Za-z0-9._-]+$/;

/** A bare host, with an optional port for a self-hosted bridge. No scheme and no path, because
 * those are the parts of a URL that decide where the browser goes. */
const BARE_HOST = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?::\d{1,5})?$/;

/**
 * Live classes on a Jitsi Meet bridge, with no JWT in front of it.
 *
 * That last clause is the whole design, so it is worth stating what it buys and what it costs.
 * It buys the POC a working class on one Linux box with no vendor account, no key to rotate and
 * nothing to renew. What it costs is that a room has no authentication of its own: on the public
 * bridge, knowing the name is the same thing as being invited. So the room name is a secret in
 * every sense but the name — minted from a uuid, returned only to the two accounts a gated
 * endpoint has already accepted, and never a string a log line or a course page is allowed to
 * carry. Everything that keeps a class private is the unguessability of this one value.
 *
 * The URL is built, not fetched. Jitsi needs no server-side call to make a room exist, which is
 * why this adapter is the shortest one in the system and why the port is synchronous.
 */
@Injectable()
export class JitsiVideo implements Video {
  private readonly domain: string;

  constructor(domain: string) {
    if (!BARE_HOST.test(domain)) throw new UnusableVideoDomainError(domain);
    this.domain = domain;
  }

  room(name: string): VideoRoom {
    if (!ROOM_NAME.test(name) || name === '.' || name === '..') throw new UnsafeRoomNameError();
    return { name, url: `https://${this.domain}/${name}` };
  }
}
