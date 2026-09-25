import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared packages ship TypeScript source, so the app compiles them.
  transpilePackages: ['@lms/ui', '@lms/shared'],
  // Dev runs on *.localtest.me so every portal gets the same session cookie domain.
  allowedDevOrigins: ['teacher.localtest.me'],
  reactStrictMode: true,
};

export default config;
