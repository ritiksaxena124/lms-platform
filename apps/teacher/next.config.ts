import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared packages ship TypeScript source, so the app compiles them.
  transpilePackages: ['@lms/ui', '@lms/shared'],
  // Dev runs on *.localtest.me so every portal gets the same session cookie domain.
  allowedDevOrigins: ['teacher.localtest.me'],
  // A container image copies `.next/standalone` — the traced subset of node_modules this app actually
  // imports — instead of the whole workspace. `next dev` and `next start` are unaffected.
  output: 'standalone',
  reactStrictMode: true,
};

export default config;
