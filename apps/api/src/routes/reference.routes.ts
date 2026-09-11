import { Router } from 'express';
import { SEED_BREEDS, SEED_DISEASES } from '@nasl/shared';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';

/**
 * Shared reference libraries. Global rather than per-farm, and read-only to farm users — the
 * admin console curates them (FR-ADM-03). Served with a long cache because they change rarely and
 * every client pulls them on first run.
 */
export function referenceRoutes(config: Config): Router {
  const router = Router();
  router.use(requireAuth(config.JWT_SECRET));

  router.get('/breeds', (_req, res) => {
    res.set('cache-control', 'public, max-age=3600');
    res.json({ breeds: SEED_BREEDS });
  });

  router.get('/diseases', (_req, res) => {
    res.set('cache-control', 'public, max-age=3600');
    res.json({ diseases: SEED_DISEASES });
  });

  return router;
}
