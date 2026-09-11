import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse } from '../http/validate.ts';
import { ReportsService } from '../services/reports.service.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const today = () => new Date(new Date().toISOString().slice(0, 10));

/** A season with no dates given means the last twelve months. */
const period = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

function resolvePeriod(input: { from?: string; to?: string }) {
  const to = input.to ? new Date(input.to) : today();
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - 365 * 86_400_000);
  return { from, to };
}

export function reportRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const reports = new ReportsService();

  router.use(requireAuth(config.JWT_SECRET));

  /**
   * The ewe scorecard. Gated on `reports:read` rather than `animals:read`, because it is the
   * document a culling decision is made from — a hired shepherd records events, the owner decides
   * which ewes stay.
   */
  router.get('/ewes', requireFarmAccess('reports:read'), async (req, res) => {
    const rows = await reports.eweScorecard(farmIdOf(req), today());
    res.json({
      ewes: rows,
      cullCandidates: rows.filter((r) => r.cullSignals.length > 0).length,
    });
  });

  router.get('/season', requireFarmAccess('reports:read'), async (req, res) => {
    const { from, to } = resolvePeriod(parse(period, req.query));
    res.json(await reports.seasonSummary(farmIdOf(req), from, to));
  });

  router.get('/composition', requireFarmAccess('reports:read'), async (req, res) => {
    res.json(await reports.flockComposition(farmIdOf(req), today()));
  });

  router.get('/treatments', requireFarmAccess('reports:read'), async (req, res) => {
    const { from, to } = resolvePeriod(parse(period, req.query));
    res.json(await reports.treatmentRegister(farmIdOf(req), from, to));
  });

  return router;
}
