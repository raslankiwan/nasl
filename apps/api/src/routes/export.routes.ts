import { Router } from 'express';
import { z } from 'zod';
import { toCsv } from '@nasl/shared';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse } from '../http/validate.ts';
import { ReportsService } from '../services/reports.service.ts';
import { Animal } from '../models/animal.model.ts';
import { Group } from '../models/group.model.ts';
import { Weight } from '../models/weight.model.ts';
import { HealthEvent } from '../models/health.model.ts';
import { Abortion, Birth, Mating, PregnancyCheck, Weaning } from '../models/breeding.model.ts';
import { Farm } from '../models/farm.model.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const today = () => new Date(new Date().toISOString().slice(0, 10));

function csvResponse(res: Parameters<Parameters<Router['get']>[1]>[1], name: string, body: string) {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${name}"`);
  res.send(body);
}

export function exportRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const reports = new ReportsService();

  router.use(requireAuth(config.JWT_SECRET));

  /** The flock register — the shape a breeder registration or a buyer asks for. */
  router.get('/flock.csv', requireFarmAccess('reports:read'), async (req, res) => {
    const farmId = farmIdOf(req);
    const [animals, groups] = await Promise.all([
      Animal.find({ farmId, deletedAt: null }).sort({ tagNumber: 1 }).lean().exec(),
      Group.find({ farmId, deletedAt: null }).lean().exec(),
    ]);
    const penName = new Map(groups.map((g) => [g._id, g.name]));
    const tagById = new Map(animals.map((a) => [a._id, a.tagNumber]));

    csvResponse(
      res,
      'flock.csv',
      toCsv(
        [
          'رقم الأذن / Tag',
          'الاسم / Name',
          'النوع / Species',
          'السلالة / Breed',
          'الجنس / Sex',
          'تاريخ الميلاد / Date of birth',
          'الأم / Dam',
          'الأب / Sire',
          'الحظيرة / Pen',
          'الحالة / Status',
          'حالة التكاثر / Repro',
          'الوزن / Weight kg',
          'يُمنع الذبح حتى / Meat withhold',
          'يُمنع الحلب حتى / Milk withhold',
        ],
        animals.map((a) => [
          a.tagNumber,
          a.name,
          a.species,
          a.breedId,
          a.sex,
          a.dateOfBirth,
          a.damId ? (tagById.get(a.damId) ?? a.damId) : null,
          a.sireId ? (tagById.get(a.sireId) ?? a.sireId) : null,
          a.currentGroupId ? (penName.get(a.currentGroupId) ?? null) : null,
          a.status,
          a.repro?.state ?? null,
          a.lastWeightKg,
          a.withholdMeatUntil,
          a.withholdMilkUntil,
        ]),
      ),
    );
  });

  /** The medicine record a compliance check asks to see (FR-RPT-04). */
  router.get('/treatments.csv', requireFarmAccess('reports:read'), async (req, res) => {
    const { from, to } = parse(period, req.query);
    const end = to ? new Date(to) : today();
    const start = from ? new Date(from) : new Date(end.getTime() - 365 * 86_400_000);

    const register = await reports.treatmentRegister(farmIdOf(req), start, end);
    csvResponse(
      res,
      'treatments.csv',
      toCsv(
        [
          'التاريخ / Date',
          'رقم الأذن / Tag',
          'النوع / Type',
          'المستحضر / Product',
          'رقم التشغيلة / Batch',
          'الجرعة / Dose',
          'طريقة الإعطاء / Route',
          'أعطاه / Administered by',
          'يُمنع الذبح حتى / Meat withhold',
          'يُمنع الحلب حتى / Milk withhold',
        ],
        register.entries.map((e) => [
          e.date,
          e.tagNumber,
          e.type,
          e.product,
          e.batchNo,
          e.doseValue === null ? null : `${e.doseValue} ${e.doseUnit ?? ''}`.trim(),
          e.route,
          e.administeredBy,
          e.withholdMeatUntil,
          e.withholdMilkUntil,
        ]),
      ),
    );
  });

  router.get('/ewes.csv', requireFarmAccess('reports:read'), async (req, res) => {
    const rows = await reports.eweScorecard(farmIdOf(req), today());
    csvResponse(
      res,
      'ewes.csv',
      toCsv(
        [
          'رقم الأذن / Tag',
          'الاسم / Name',
          'العمر بالأشهر / Age months',
          'الولادات / Lambings',
          'المواليد / Lambs born',
          'الأحياء / Live',
          'المفطومة / Weaned',
          'متوسط عدد المواليد / Avg litter',
          'الفترة بين الولادتين / Interval days',
          'ولادات متعسّرة / Assisted',
          'آخر ولادة / Last lambed',
          'مؤشرات الاستبعاد / Cull signals',
        ],
        rows.map((r) => [
          r.tagNumber,
          r.name,
          r.ageMonths,
          r.lambings,
          r.lambsBorn,
          r.lambsLive,
          r.lambsWeaned,
          r.averageLitterSize,
          r.averageLambingIntervalDays,
          r.assistedLambings,
          r.lastLambedAt,
          r.cullSignals.join('; '),
        ]),
      ),
    );
  });

  /**
   * Everything this farm owns, as JSON (FR-RPT-07).
   *
   * The customer must be able to leave. A product that holds a herder's records hostage has
   * stopped being a tool and started being a trap, and the export is the difference.
   */
  router.get('/full.json', requireFarmAccess('reports:read'), async (req, res) => {
    const farmId = farmIdOf(req);
    const query = { farmId, deletedAt: null };

    const [farm, animals, groups, matings, checks, births, weanings, abortions, health, weights] =
      await Promise.all([
        Farm.findById(farmId).lean().exec(),
        Animal.find(query).lean().exec(),
        Group.find(query).lean().exec(),
        Mating.find(query).lean().exec(),
        PregnancyCheck.find(query).lean().exec(),
        Birth.find(query).lean().exec(),
        Weaning.find(query).lean().exec(),
        Abortion.find(query).lean().exec(),
        HealthEvent.find(query).lean().exec(),
        Weight.find(query).lean().exec(),
      ]);

    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="nasl-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      farm,
      animals,
      groups,
      matings,
      pregnancyChecks: checks,
      births,
      weanings,
      abortions,
      healthEvents: health,
      weights,
    });
  });

  return router;
}
