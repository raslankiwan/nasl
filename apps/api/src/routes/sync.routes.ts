import { Router } from 'express';
import type { Role } from '@nasl/shared';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse } from '../http/validate.ts';
import { SyncService } from '../services/sync.service.ts';

const SCHEMA_VERSION = 1;
const pullInput = z.object({
  lastPulledAt: z.string().datetime().nullable().optional(),
  schemaVersion: z.number().int().min(1).default(SCHEMA_VERSION),
  limit: z.number().int().min(1).max(1000).default(500),
  page: z
    .object({
      until: z.string().datetime(),
      after: z.record(
        z.string(),
        z.object({ at: z.string().datetime(), id: z.string().uuid() }).nullable(),
      ),
    })
    .optional(),
});

export function syncRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const sync = new SyncService();
  router.use(requireAuth(config.JWT_SECRET));
  router.post('/pull', requireFarmAccess('animals:read'), async (req, res) => {
    const input = parse(pullInput, req.body);
    if (input.schemaVersion > SCHEMA_VERSION) {
      res.status(426).json({
        error: {
          code: 'bad_request',
          message: 'This server is older than the app. Try again shortly.',
        },
      });
      return;
    }
    const since = input.lastPulledAt ? new Date(input.lastPulledAt) : new Date(0);
    const result = await sync.pull(
      farmIdOf(req),
      since,
      input.limit,
      req.membership!.role as Role,
      input.page,
    );
    res.json({
      ...result,
      timestamp: result.timestamp.toISOString(),
      schemaVersion: SCHEMA_VERSION,
    });
  });

  // Raw model upserts bypassed permissions, parentage, withdrawal and event side effects.
  // The shipped app already replays its outbox through the normal validated capture routes.
  // Reject legacy writers explicitly, preserving their records for an upgraded client.
  router.post('/push', requireFarmAccess('animals:write'), (_req, res) => {
    res.status(426).json({
      error: {
        code: 'sync_upgrade_required',
        message:
          'Update the app to send saved records through the validated capture routes. Your records have not been changed.',
      },
    });
  });
  router.get('/meta', requireFarmAccess('animals:read'), (req, res) => {
    res.json({
      schemaVersion: SCHEMA_VERSION,
      collections: SyncService.collectionsFor(req.membership!.role as Role),
      writeMode: 'capture-routes',
    });
  });
  return router;
}
