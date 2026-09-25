import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'node:fs';

import { PrismaService } from '../prisma/prisma.service';

/**
 * The API is always started from `apps/api` (dev via `nest start`, prod via
 * `node dist/main.js`), so the manifest is read relative to the working directory
 * instead of `__dirname`, which does not exist once the code is bundled or ESM-loaded.
 */
const APP_VERSION: string = (() => {
  try {
    const raw = readFileSync('package.json', 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** Liveness for the reverse proxy plus a real dependency check for deployment gates. */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const databaseUp = await this.prisma.isHealthy();
    const body = {
      status: databaseUp ? ('ok' as const) : ('degraded' as const),
      database: databaseUp ? ('up' as const) : ('down' as const),
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    if (!databaseUp) {
      throw new ServiceUnavailableException(body, { description: 'Database unavailable' });
    }
    return body;
  }
}
