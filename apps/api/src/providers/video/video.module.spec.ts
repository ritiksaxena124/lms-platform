import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ENV, EnvModule } from '../../config/env.module';
import { JitsiVideo } from './jitsi-video.adapter';
import { NoVideo } from './no-video.adapter';
import { buildVideo, VideoModule } from './video.module';
import { VIDEO, type Video } from './video.port';

/**
 * Which adapter the environment asks for, and what a deployment with no live video at all
 * answers. The port is only worth having if that choice is made in exactly one place, and a
 * route injected with `VIDEO` should not also have to know whether this box points classes at a
 * Jitsi bridge or has not decided yet.
 */
describe('video provider selection', () => {
  it('builds the Jitsi adapter for the provider the environment names', () => {
    expect(buildVideo({ VIDEO_PROVIDER: 'jitsi', JITSI_DOMAIN: 'meet.jit.si' })).toBeInstanceOf(
      JitsiVideo,
    );
  });

  it('builds a port with no rooms where live video is not wired up', () => {
    const video = buildVideo({ VIDEO_PROVIDER: 'none', JITSI_DOMAIN: 'meet.jit.si' });

    expect(video).toBeInstanceOf(NoVideo);
    // This is the question a caller actually asks, which is why `none` is an implementation
    // rather than an `if` in every route: a booked class on a `none` deployment has nowhere to
    // go, and the endpoint that says so should not be the one guessing at a public bridge.
    expect(video.room('booking-7')).toBeNull();
  });

  it('refuses a provider it has no adapter for, rather than quietly running without video', () => {
    // The silent direction of this failure is the dangerous one: a teacher who believes the
    // class is live, and a Join button that goes nowhere.
    expect(() =>
      buildVideo({ VIDEO_PROVIDER: 'mock', JITSI_DOMAIN: 'meet.jit.si' } as never),
    ).toThrow(/mock/i);
  });

  it('refuses a Jitsi domain that cannot be a bare host, at the moment the port is built', () => {
    expect(() =>
      buildVideo({ VIDEO_PROVIDER: 'jitsi', JITSI_DOMAIN: 'meet.jit.si/rooms' }),
    ).toThrow(/JITSI_DOMAIN/i);
  });

  it('hands the port to anything that asks for it by token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule, VideoModule],
    })
      // Named here rather than inherited from the ambient environment, so the spec says what it
      // proves no matter what a developer's own .env has decided about live video.
      .overrideProvider(ENV)
      .useValue({ VIDEO_PROVIDER: 'jitsi', JITSI_DOMAIN: 'meet.jit.si' })
      .compile();

    expect(moduleRef.get<Video>(VIDEO)).toBeInstanceOf(JitsiVideo);
  });
});
