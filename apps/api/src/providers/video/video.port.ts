/**
 * Where a live class happens, stated without naming a vendor SDK (ARCHITECTURE §10).
 *
 * The chosen provider needs no handshake — a Jitsi room exists the moment someone types its name
 * — so this port turns a name into an address and nothing else. It is deliberately synchronous
 * for the same reason: a `Promise` here would be theatre until a provider that signs its URLs
 * arrives, and that provider would change the shape of the answer, not merely its asynchrony.
 *
 * Two rules are inherited from the storage port (§6) because they earned their place there.
 *
 * **The caller mints the room name.** A name on a public bridge is the only thing keeping a
 * class private, so it is derived from something nobody can guess — and the route that owns the
 * booking owns that decision, exactly as the route that owns an upload owns its key. Nothing
 * here builds a name out of a course title, a date or a lesson id, because every one of those is
 * a name a stranger could work out.
 *
 * **An address is not a permission.** This port answers "where would this room be", never "may
 * this person join". The gate is the endpoint in §14, and a portal that learned to ask the port
 * directly would be a door with nobody standing in it.
 */
export const VIDEO = Symbol('VIDEO');

/** A class's meeting, as both portals need to know it: what it is called, and what to open. */
export interface VideoRoom {
  /** The meeting identity — the name this platform minted for the room. */
  name: string;
  /** What an iframe opens. A URL is the whole of what a provider hands back; no client object,
   * no SDK type, nothing that ties a route to one vendor's library. */
  url: string;
}

export interface Video {
  /**
   * The room a class named `name` would be held in, or `null` where this deployment has no live
   * video at all. `null` rather than a throw: `VIDEO_PROVIDER=none` is a configuration people
   * run, and the caller's job is to tell the teacher the class has no room rather than to
   * discover that the box is misconfigured.
   */
  room(name: string): VideoRoom | null;
}

/** A name that would make the address mean something other than one room: it carries a path, a
 * query, a fragment, whitespace, or is not a name at all. Thrown, not returned — a caller that
 * asks for `../somebody-elses-class` has a bug, and answering it with `null` would hide it. */
export class UnsafeRoomNameError extends Error {
  constructor() {
    super('Room name must be a single plain path segment');
    this.name = 'UnsafeRoomNameError';
  }
}

/** The configured bridge host is not a host. Refused where the provider is built, which is at
 * boot: a deployment should find out that its video config would send classes somewhere
 * unintended before a teacher has a class to teach. */
export class UnusableVideoDomainError extends Error {
  constructor(domain: string) {
    super(`JITSI_DOMAIN must be a bare host, not "${domain}"`);
    this.name = 'UnusableVideoDomainError';
  }
}
