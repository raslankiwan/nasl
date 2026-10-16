import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '../models/auditLog.model.ts';
import { Farm } from '../models/farm.model.ts';
import { Membership } from '../models/membership.model.ts';
import { User } from '../models/user.model.ts';
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
  test('staff can provision a farm for its owner, with membership and an audit entry', async () => {
    await withServer(testApp(), async (url) => {
      const owner = await signIn(url, '+970592320211', 'Owner');
      const staff = await signIn(url, '+970592320212', 'Ops');
      await makePlatformAdmin(staff.user.id);

      const created = await api(url, staff.accessToken).post<FarmRow>('/v1/admin/farms', {
        name: '  مزرعة جديدة  ',
        ownerPhone: '+970 592320211',
        species: ['sheep', 'goat'],
        reason: 'Owner requested onboarding',
        ownerUserId: staff.user.id,
        plan: 'commercial',
      });
      assert.equal(created.status, 201);
      const farm = await Farm.findById(created.body.id).lean();
      assert.equal(farm?.name, 'مزرعة جديدة');
      assert.equal(farm?.ownerUserId, owner.user.id);
      assert.equal(farm?.country, 'PS');
      assert.equal(farm?.currency, 'ILS');
      assert.equal(farm?.timezone, 'Asia/Hebron');
      assert.equal(farm?.plan, 'free');
      assert.deepEqual(farm?.species, ['sheep', 'goat']);

      const memberships = await Membership.find({ farmId: created.body.id }).lean();
      assert.equal(memberships.length, 1);
      assert.equal(memberships[0]?.userId, owner.user.id);
      assert.equal(memberships[0]?.role, 'owner');
      assert.equal(memberships[0]?.status, 'active');
      assert.equal(memberships[0]?.invitedBy, staff.user.id);
      const profile = await api(url, owner.accessToken).get<{
        farms: Array<{ farmId: string; role: string }>;
      }>('/v1/auth/me');
      assert.deepEqual(profile.body.farms, [{ farmId: created.body.id, role: 'owner' }]);
      assert.equal(
        (await api(url, staff.accessToken).get(`/v1/farms/${created.body.id}`)).status,
        403,
      );

      const audit = await AuditLog.findOne({ targetId: created.body.id }).lean();
      assert.equal(audit?.action, 'farm.create');
      assert.equal(audit?.actorId, staff.user.id);
      assert.equal(audit?.reason, 'Owner requested onboarding');
      assert.equal((audit?.after as { ownerUserId: string }).ownerUserId, owner.user.id);
    });
  });

  test('farm provisioning requires staff access', async () => {
    await withServer(testApp(), async (url) => {
      const owner = await signIn(url, '+970592320211');
      const input = { name: 'Farm', ownerPhone: '+970592320211', reason: 'Onboarding' };
      assert.equal((await api(url).post('/v1/admin/farms', input)).status, 401);
      assert.equal((await api(url, owner.accessToken).post('/v1/admin/farms', input)).status, 404);
      assert.equal(await Farm.countDocuments(), 0);
    });
  });

  test('a new owner is provisioned without a reason and can later sign in to the farm', async () => {
    await withServer(testApp(), async (url) => {
      const staff = await signIn(url, '+970592320212');
      await makePlatformAdmin(staff.user.id);
      const created = await api(url, staff.accessToken).post<FarmRow>('/v1/admin/farms', {
        name: 'New owner farm',
        ownerPhone: '+970 592320299',
        isPlatformAdmin: true,
      });
      assert.equal(created.status, 201);
      const owner = await User.findOne({ phone: '+970592320299' }).lean();
      assert.ok(owner);
      assert.match(owner._id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
      assert.equal(owner.isPlatformAdmin, false);
      assert.equal(owner.locale, 'ar');
      assert.equal(owner.lastSeenAt, undefined);
      const audit = await AuditLog.findOne({ targetId: created.body.id }).lean();
      assert.equal(audit?.action, 'farm.create');
      assert.equal(audit?.reason, null);

      const session = await signIn(url, '+970592320299', 'New owner');
      assert.equal(session.user.id, owner._id);
      assert.equal(session.user.name, 'New owner');
      const profile = await api(url, session.accessToken).get<{
        farms: Array<{ farmId: string; role: string }>;
      }>('/v1/auth/me');
      assert.deepEqual(profile.body.farms, [{ farmId: created.body.id, role: 'owner' }]);
      assert.equal(await User.countDocuments({ phone: '+970592320299' }), 1);
    });
  });

  test('concurrent farm creation reuses one account and accepts blank or short reasons', async () => {
    await withServer(testApp(), async (url) => {
      const staff = await signIn(url, '+970592320212');
      await makePlatformAdmin(staff.user.id);
      const client = api(url, staff.accessToken);
      const results = await Promise.all(
        ['', '  ', 'x'].map((reason, index) =>
          client.post<FarmRow>('/v1/admin/farms', {
            name: `Farm ${index}`,
            ownerPhone: '+970592320299',
            reason,
          }),
        ),
      );
      for (const result of results) assert.equal(result.status, 201);
      const owner = await User.findOne({ phone: '+970592320299' }).lean();
      assert.ok(owner);
      assert.equal(await User.countDocuments({ phone: owner.phone }), 1);
      assert.equal(await Membership.countDocuments({ userId: owner._id, role: 'owner' }), 3);
      for (const [index, result] of results.entries()) {
        const audit = await AuditLog.findOne({ targetId: result.body.id }).lean();
        assert.equal(audit?.reason, index === 2 ? 'x' : null);
      }
    });
  });

  test('invalid details leave no new account, farm or membership behind', async () => {
    await withServer(testApp(), async (url) => {
      const staff = await signIn(url, '+970592320212');
      await makePlatformAdmin(staff.user.id);
      const client = api(url, staff.accessToken);
      const input = { name: 'Farm', ownerPhone: '+970592320299', reason: 'Onboarding' };
      for (const invalid of [
        { name: ' ' },
        { reason: 'x'.repeat(301) },
        { species: [] },
        { ownerPhone: '592320211' },
      ]) {
        assert.equal((await client.post('/v1/admin/farms', { ...input, ...invalid })).status, 400);
      }
      assert.equal(await Farm.countDocuments(), 0);
      assert.equal(await Membership.countDocuments(), 0);
      assert.equal(await AuditLog.countDocuments(), 0);
      assert.equal(await User.countDocuments(), 1);
    });
  });

  test('a failed audit rolls back the newly provisioned farm and membership', async (t) => {
    await withServer(testApp(), async (url) => {
      const staff = await signIn(url, '+970592320212');
      await makePlatformAdmin(staff.user.id);
      t.mock.method(AuditLog, 'create', async () => {
        throw new Error('Audit unavailable');
      });
      const response = await api(url, staff.accessToken).post('/v1/admin/farms', {
        name: 'Farm',
        ownerPhone: '+970592320212',
        reason: 'Onboarding',
      });
      assert.equal(response.status, 500);
      assert.equal(await Farm.countDocuments(), 0);
      assert.equal(await Membership.countDocuments(), 0);
    });
  });

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
