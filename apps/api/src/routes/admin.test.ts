import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '../models/auditLog.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import {
  api,
  makePlatformAdmin,
  signIn,
  signInWithFarm,
  testApp,
  withServer,
} from '../testing/harness.ts';

interface FarmRow {
  id: string;
  name: string;
  plan: string;
  headCount: number;
}
interface ProductBody {
  _id: string;
  nameEn: string;
  withdrawalMeatDays: number;
}
interface ErrorBody {
  error: { code: string; message: string };
}

const PRODUCT = {
  nameAr: 'أوكسي تتراسيكلين',
  nameEn: 'Oxytetracycline 20%',
  kind: 'antibiotic',
  activeIngredient: 'oxytetracycline',
  withdrawalMeatDays: 28,
  withdrawalMilkDays: 7,
  source: 'Manufacturer datasheet rev. 2025-04',
};

before(async () => {
  await startTestMongo();
});
after(async () => {
  await stopTestMongo();
});
beforeEach(async () => {
  await clearDatabase();
});

describe('operator console access', () => {
  test('a farm user cannot see the console exists', async () => {
    await withServer(testApp(), async (url) => {
      const { session } = await signInWithFarm(url, '+966501111111');
      const res = await api(url, session.accessToken).get<ErrorBody>('/v1/admin/stats');
      assert.equal(res.status, 404, 'not 403 — the console is not advertised to farm users');
    });
  });

  test('an anonymous caller is rejected', async () => {
    await withServer(testApp(), async (url) => {
      assert.equal((await api(url).get('/v1/admin/stats')).status, 401);
    });
  });

  test('platform staff see the dashboard', async () => {
    await withServer(testApp(), async (url) => {
      const staff = await signIn(url, '+966509999999', 'Ops');
      await makePlatformAdmin(staff.user.id);

      const res = await api(url, staff.accessToken).get<{ farms: number; activeAnimals: number }>(
        '/v1/admin/stats',
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.farms, 0);
    });
  });
});

describe('tenant directory', () => {
  test('farms are listed with their live head count', async () => {
    await withServer(testApp(), async (url) => {
      const { session, farmId } = await signInWithFarm(url, '+966501111111', 'مراح الشمال');
      await api(url, session.accessToken).post(`/v1/farms/${farmId}/animals/bulk`, {
        animals: [
          { tagNumber: '1001', species: 'sheep', sex: 'female' },
          { tagNumber: '1002', species: 'sheep', sex: 'female' },
        ],
      });

      const staff = await signIn(url, '+966509999999', 'Ops');
      await makePlatformAdmin(staff.user.id);

      const res = await api(url, staff.accessToken).get<{ farms: FarmRow[]; total: number }>(
        '/v1/admin/farms',
      );
      assert.equal(res.body.total, 1);
      assert.equal(res.body.farms[0]?.name, 'مراح الشمال');
      assert.equal(res.body.farms[0]?.headCount, 2);
    });
  });

  test('the directory resolves owners through an $in query', async () => {
    // Regression: a global `sanitizeFilter` rewrote `{ _id: { $in: [...] } }` into an equality
    // check against the operator object itself and turned this endpoint into a 500.
    await withServer(testApp(), async (url) => {
      await signInWithFarm(url, '+966501111111', 'مراح الشمال');
      const staff = await signIn(url, '+966509999999', 'Ops');
      await makePlatformAdmin(staff.user.id);

      const res = await api(url, staff.accessToken).get<{
        farms: Array<{ owner: { name: string | null } | null }>;
      }>('/v1/admin/farms');

      assert.equal(res.status, 200);
      assert.equal(res.body.farms.length, 1);
      assert.ok(res.body.farms[0]?.owner, 'the owner must be resolved, not dropped');
    });
  });

  test('a plan change needs a reason and lands in the audit log', async () => {
    await withServer(testApp(), async (url) => {
      const { farmId } = await signInWithFarm(url, '+966501111111');
      const staff = await signIn(url, '+966509999999', 'Ops');
      await makePlatformAdmin(staff.user.id);
      const client = api(url, staff.accessToken);

      const noReason = await client.post<ErrorBody>(`/v1/admin/farms/${farmId}/plan`, {
        plan: 'commercial',
      });
      assert.ok(noReason.status >= 400);

      const res = await fetch(`${url}/v1/admin/farms/${farmId}/plan`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${staff.accessToken}`,
        },
        body: JSON.stringify({ plan: 'commercial', reason: 'Signed annual contract' }),
      });
      assert.equal(res.status, 200);

      const entry = await AuditLog.findOne({ targetId: farmId }).lean();
      assert.equal(entry?.action, 'farm.plan.change');
      assert.equal(entry?.actorId, staff.user.id);
      assert.equal(entry?.reason, 'Signed annual contract');
      assert.deepEqual(entry?.before, { plan: 'free' });
      assert.deepEqual(entry?.after, { plan: 'commercial' });
    });
  });
});

describe('veterinary product library', () => {
  test('a product cannot be added without a source for its withdrawal figures', async () => {
    await withServer(testApp(), async (url) => {
      const staff = await signIn(url, '+966509999999', 'Ops');
      await makePlatformAdmin(staff.user.id);

      const { source: _source, ...withoutSource } = PRODUCT;
      const res = await api(url, staff.accessToken).post<ErrorBody>(
        '/v1/admin/products',
        withoutSource,
      );
      assert.equal(res.status, 400, 'an unsourced withdrawal figure is a guess');
    });
  });

  test('adding and amending a product is audited with before and after', async () => {
    await withServer(testApp(), async (url) => {
      const staff = await signIn(url, '+966509999999', 'Ops');
      await makePlatformAdmin(staff.user.id);
      const client = api(url, staff.accessToken);

      const created = await client.post<ProductBody>('/v1/admin/products', PRODUCT);
      assert.equal(created.status, 201);
      assert.equal(created.body.withdrawalMeatDays, 28);

      const res = await fetch(`${url}/v1/admin/products/${created.body._id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${staff.accessToken}`,
        },
        body: JSON.stringify({
          withdrawalMeatDays: 35,
          reason: 'Datasheet rev. 2026-02 lengthened the period',
        }),
      });
      assert.equal(res.status, 200);

      const entries = await AuditLog.find({ targetId: created.body._id })
        .sort({ createdAt: 1 })
        .lean();
      assert.equal(entries.length, 2);
      assert.equal(entries[1]?.action, 'product.update');
      assert.equal((entries[1]?.before as { withdrawalMeatDays: number }).withdrawalMeatDays, 28);
      assert.equal((entries[1]?.after as { withdrawalMeatDays: number }).withdrawalMeatDays, 35);
    });
  });

  test('a farm user cannot reach the product library', async () => {
    await withServer(testApp(), async (url) => {
      const { session } = await signInWithFarm(url, '+966501111111');
      assert.equal((await api(url, session.accessToken).get('/v1/admin/products')).status, 404);
    });
  });
});
