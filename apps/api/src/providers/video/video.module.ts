import { Module } from '@nestjs/common';

import type { AppEnv } from '../../config/env';
import { ENV } from '../../config/env.module';
import { JitsiVideo } from './jitsi-video.adapter';
import { NoVideo } from './no-video.adapter';
import { VIDEO, type Video } from './video.port';

/** The part of the environment this choice needs — spelled out so a spec can name a provider
 * without inventing a whole config. */
export type VideoEnv = Pick<AppEnv, 'VIDEO_PROVIDER' | 'JITSI_DOMAIN'>;

/**
 * The one place a provider string becomes an object.
 *
 * Both answers are complete: `jitsi` is what a deployment with live classes runs, and `none` is
 * what one without them runs. Anything else stops here rather than choosing for the operator —
 * defaulting an unknown value to `none` would boot a school's classes into a system that quietly
 * has no rooms, which is the one failure a teacher discovers in front of a waiting student.
 */
export function buildVideo(env: VideoEnv): Video {
  if (env.VIDEO_PROVIDER === 'jitsi') return new JitsiVideo(env.JITSI_DOMAIN);
  if (env.VIDEO_PROVIDER === 'none') return new NoVideo();

  throw new Error(
    `Video provider "${env.VIDEO_PROVIDER}" has no adapter; set VIDEO_PROVIDER=jitsi or VIDEO_PROVIDER=none`,
  );
}

@Module({
  providers: [
    {
      provide: VIDEO,
      useFactory: (env: AppEnv) => buildVideo(env),
      inject: [ENV],
    },
  ],
  exports: [VIDEO],
})
export class VideoModule {}
