import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse } from '../http/validate.ts';
import { SyncService, type Changes } from '../services/sync.service.ts';

/**
 * The device's schema version. A client more than one version behind the server may be sending
 * shapes we no longer understand, and silently dropping its records is the worst possible outcome
 * — so it is told to update rather than allowed to sync into a hole (NFR-13).
 */
const SCHEMA_VERSION = 1;

const changeSet = z.object({
  created: z.array(z.record(z.string(), z.unknown())).default([]),
  updated: z.array(z.record(z.string(), z.unknown())).default([]),
  deleted: z.array(z.string()).default([]),
});

const pullInput = z.object({
  lastPulledAt: z.string().datetime().nullable().optional(),
  schemaVersion: z.number().int().min(1).default(SCHEMA_VERSION),
  limit: z.number().int().min(1).max(1000).default(500),
});

const pushInput = z.object({
  schemaVersion: z.number().int().min(1).default(SCHEMA_VERSION),
  changes: z.record(z.string(), changeSet),
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

    // No cursor means a first sync: send the whole farm.
    const since = input.lastPulledAt ? new Date(input.lastPulledAt) : new Date(0);
    const result = await sync.pull(farmIdOf(req), since, input.limit);

    res.json({
      timestamp: result.timestamp.toISOString(),
      schemaVersion: SCHEMA_VERSION,
      changes: result.changes,
    });
  });

  router.post('/push', requireFarmAccess('animals:write'), async (req, res) => {
    const input = parse(pushInput, req.body);
    SyncService.assertKnownCollections(input.changes as Changes);

    const result = await sync.push(farmIdOf(req), input.changes as Changes);

    res.status(200).json({
      applied: result.applied,
      rejected: result.rejected,
      recomputed: result.recomputed.length,
      // The client adopts this as its next cursor.
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/meta', requireFarmAccess('animals:read'), (_req, res) => {
    res.json({ schemaVersion: SCHEMA_VERSION, collections: SyncService.collectionNames });
  });

  return router;
}
