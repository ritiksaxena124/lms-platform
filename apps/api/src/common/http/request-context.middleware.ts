import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { AppLogger } from '../logging/app-logger.service';
import { runWithLogContext } from '../logging/log-context';
import { API_PREFIX } from './api-prefix';

/**
 * Plain Express middleware rather than a Nest `MiddlewareConsumer`: it runs ahead of the
 * router so it also covers paths Nest never matches (the 404 case), and it avoids the
 * `forRoutes('*')` path-to-regexp warning on Nest 11.
 *
 * Establishes the request identity before any handler runs and emits exactly one access
 * log line per request. A client may supply its own id (truncated) so a browser trace
 * and a server log can be correlated.
 */
export function createRequestContextMiddleware(logger: AppLogger) {
  return function requestContext(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const startedAt = Date.now();
    res.on('finish', () => {
      // Health checks are polled by the proxy and would drown out real traffic.
      if (req.path === `${API_PREFIX}/health`) return;
      logger.request(req, res.statusCode, Date.now() - startedAt);
    });

    runWithLogContext({ requestId }, () => next());
  };
}
