import { describe, expect, it } from 'vitest';

import { JitsiVideo } from './jitsi-video.adapter';

/**
 * What a room address is made of, and what can break it.
 *
 * The no-JWT decision (ARCHITECTURE §10) means this adapter never speaks to the network: its
 * whole job is to put two strings together. So every risk it carries is that one of those
 * strings is longer than a name — a room carrying a slash or a `?` can point an iframe somewhere
 * the deployment never approved, and a domain carrying a scheme is the same trick from the other
 * end. The two refusal specs below are the reason this class is worth having at all.
 */
describe('JitsiVideo', () => {
  const video = new JitsiVideo('meet.jit.si');

  it('addresses a room under the configured domain', () => {
    expect(video.room('a4c1f2e8-7f4b-4b1e-9e0a-2c5f1d3b8a77')).toEqual({
      name: 'a4c1f2e8-7f4b-4b1e-9e0a-2c5f1d3b8a77',
      url: 'https://meet.jit.si/a4c1f2e8-7f4b-4b1e-9e0a-2c5f1d3b8a77',
    });
  });

  it('uses the domain the environment named rather than the one it defaults to', () => {
    expect(new JitsiVideo('calls.example-school.org').room('class-1')?.url).toBe(
      'https://calls.example-school.org/class-1',
    );
    // A self-hosted bridge is the same adapter with a port on its host.
    expect(new JitsiVideo('jitsi.internal:8443').room('class-1')?.url).toBe(
      'https://jitsi.internal:8443/class-1',
    );
  });

  it('answers the same address twice for one name', () => {
    // The teacher opens this and the student opens it a minute later. Two answers for one class
    // would be two rooms, each of which would look empty to the other.
    expect(video.room('booking-7')).toEqual(video.room('booking-7'));
  });

  it('refuses a name that could carry the address somewhere else', () => {
    for (const hostile of [
      '../../another-room',
      '..',
      '.',
      'a/b',
      'a?next=other',
      'a#b',
      'https://evil.example/x',
      'a b',
      ' ',
      '',
    ]) {
      expect(() => video.room(hostile)).toThrow(/room name/i);
    }
  });

  it('refuses to boot on a domain that is not a bare host', () => {
    // `https://${domain}/${name}` assumes the domain is a host and nothing else. A value with a
    // scheme, a path or an authority-ending slash turns the deployment's own config into the
    // part that decides where a class is held.
    for (const bad of [
      'https://meet.jit.si',
      'meet.jit.si/rooms',
      '/meet.jit.si',
      'meet.jit.si/',
      'meet jit si',
      '',
    ]) {
      expect(() => new JitsiVideo(bad)).toThrow(/JITSI_DOMAIN/i);
    }
  });
});
