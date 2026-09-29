import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared packages ship TypeScript source, so the app compiles them.
  transpilePackages: ['@lms/ui', '@lms/shared'],
  // Dev runs on *.localtest.me like the portals, so one browser profile can hold the whole product
  // open at once. This app has no session of its own: it is the face, and it links to the doors.
  allowedDevOrigins: ['site.localtest.me'],
  reactStrictMode: true,
  // Static from the first file. The roadmap's promise is "not a second backend", and a build that
  // emits only files is the version of that promise the machine can check: a route handler, a piece
  // of middleware or an image optimizer asked for at request time fails here rather than quietly
  // turning this workspace into a server on the box that hosts it.
  output: 'export',
  // `next dev` still serves the app; this only says what `next build` produces, which is what gets
  // read in verification and what a web root would be handed.
  typedRoutes: false,
};

export default config;
