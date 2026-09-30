import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'node:fs';

import { Public } from '../../modules/auth/public.decorator';
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

/**
 * Whether the API is up and whether its database is, with the version that answered.
 *
 * A deployment gate reads `database` rather than `status`: the process being alive says nothing
 * about whether it can reach the rows it serves.
 */
interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

/** Liveness for the reverse proxy plus a real dependency check for deployment gates. */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
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
