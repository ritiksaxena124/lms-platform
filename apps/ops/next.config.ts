import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared packages ship TypeScript source, so the app compiles them.
  transpilePackages: ['@lms/ui', '@lms/shared'],
  // Dev runs on *.localtest.me so every portal gets the same session cookie domain — which is
  // exactly why this one has to check the role it was handed, not just the fact of a session.
  allowedDevOrigins: ['ops.localtest.me'],
  reactStrictMode: true,
};

export default config;
