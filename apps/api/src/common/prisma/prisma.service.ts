import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { AppLogger } from '../logging/app-logger.service';

/**
 * The only place a Prisma client is constructed. Repositories (from Phase 2 on) receive
 * this service; controllers never touch Prisma directly.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger();

  constructor() {
    super({
      // Query text carries filter values that can be personally meaningful, so Prisma's
      // own logger is kept out of app logs; slow queries are logged by duration instead.
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(error as Error, { event: 'health_check_failed' });
      return false;
    }
  }
}
