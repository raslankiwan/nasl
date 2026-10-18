import { AnimalRepository } from '../repositories/animal.repository.ts';
import { after, before, beforeEach, describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Animal } from '../models/animal.model.ts';
import { VetProduct } from '../models/vetProduct.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface AnimalBody {
  id: string;
  tagNumber: string;
  withholdMeatUntil: string | null;
  withholdMilkUntil: string | null;
}
interface TreatmentBody {
  recorded: number;
  groupBatchId: string | null;
  withdrawal: { meatUntil: string | null; milkUntil: string | null };
}
interface WithdrawalBody {
  meat: Array<{ tagNumber: string; until: string; daysLeft: number }>;
  milk: Array<{ tagNumber: string; until: string; daysLeft: number }>;
}
interface ErrorBody {
  error: { code: string; message: string };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

/** An antibiotic with a long meat hold and a short milk hold — the shapes differ in practice. */
async function seedAntibiotic() {
  return VetProduct.create({
    nameAr: 'أوكسي تتراسيكلين',
    nameEn: 'Oxytetracycline 20%',
    kind: 'antibiotic',
    withdrawalMeatDays: 28,
    withdrawalMilkDays: 7,
    source: 'Manufacturer datasheet rev. 2025-04',
  });
}

/** A clostridial vaccine: no hold at all, which must impose no restriction. */
async function seedVaccine() {
  return VetProduct.create({
    nameAr: 'لقاح التسمم المعوي',
    nameEn: 'Clostridial vaccine',
    kind: 'vaccine',
    withdrawalMeatDays: 0,
    withdrawalMilkDays: 0,
    source: 'Manufacturer datasheet',
  });
}

async function flock(url: string, phone = '+966501111111', tags = ['1001', '1002']) {
  const { session, farmId } = await signInWithFarm(url, phone);
  const client = api(url, session.accessToken);
  const created = await client.post<{ created: AnimalBody[] }>(`/v1/farms/${farmId}/animals/bulk`, {
    animals: tags.map((tagNumber) => ({ tagNumber, species: 'sheep', sex: 'female' })),
  });
  return { client, farmId, animals: created.body.created };
}

before(async () => {
  await startTestMongo();
});
after(async () => {
  await stopTestMongo();
});
beforeEach(async () => {
  await clearDatabase();
});

describe('recording a treatment', () => {
  test('a product with holds sets both withdrawal dates on the animal', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await flock(url);
      const product = await seedAntibiotic();

      const res = await client.post<TreatmentBody>(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: iso(new Date()),
        type: 'treatment',
        productId: product._id,
        doseValue: 10,
        doseUnit: 'ml',
        route: 'subcutaneous',
        administeredBy: 'أبو سعد',
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.recorded, 1);
      assert.equal(res.body.withdrawal.meatUntil, daysFromNow(28));
      assert.equal(res.body.withdrawal.milkUntil, daysFromNow(7));

      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animals[0]!.id}`);
      assert.equal(animal.body.withholdMeatUntil, daysFromNow(28));
      assert.equal(animal.body.withholdMilkUntil, daysFromNow(7));
    });
  });

  test('a vaccine with no hold imposes no restriction', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await flock(url);
      const product = await seedVaccine();

      const res = await client.post<TreatmentBody>(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: iso(new Date()),
        type: 'vaccination',
        productId: product._id,
        administeredBy: 'أبو سعد',
      });

      assert.equal(res.body.withdrawal.meatUntil, null);
      assert.equal(res.body.withdrawal.milkUntil, null);
      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animals[0]!.id}`);
      assert.equal(animal.body.withholdMeatUntil, null);
    });
  });

  test('overlapping treatments widen the restriction, never shorten it', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await flock(url);
      const long = await seedAntibiotic();
      const short = await VetProduct.create({
        nameAr: 'مضاد قصير',
        nameEn: 'Short-acting',
        kind: 'antibiotic',
        withdrawalMeatDays: 3,
        withdrawalMilkDays: 2,
        source: 'datasheet',
      });

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: iso(new Date()),
        type: 'treatment',
        productId: long._id,
        administeredBy: 'أبو سعد',
      });
      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: iso(new Date()),
        type: 'treatment',
        productId: short._id,
        administeredBy: 'أبو سعد',
      });

      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animals[0]!.id}`);
      assert.equal(animal.body.withholdMeatUntil, daysFromNow(28), 'the longer hold survives');
      assert.equal(animal.body.withholdMilkUntil, daysFromNow(7));
    });
  });

  test('a later treatment can extend a restriction already running', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await flock(url);
      const short = await VetProduct.create({
        nameAr: 'قصير',
        nameEn: 'Short',
        kind: 'antibiotic',
        withdrawalMeatDays: 5,
        withdrawalMilkDays: 1,
        source: 'datasheet',
      });
      const long = await seedAntibiotic();

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: iso(new Date()),
        type: 'treatment',
        productId: short._id,
        administeredBy: 'أبو سعد',
      });
      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: iso(new Date()),
        type: 'treatment',
        productId: long._id,
        administeredBy: 'أبو سعد',
      });

      const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animals[0]!.id}`);
      assert.equal(animal.body.withholdMeatUntil, daysFromNow(28));
    });
  });

  test('a whole pen is treated as one act with a shared batch id', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await flock(url);
      const product = await seedAntibiotic();

      const res = await client.post<TreatmentBody>(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: animals.map((a) => a.id),
        date: iso(new Date()),
        type: 'treatment',
        productId: product._id,
        administeredBy: 'أبو سعد',
      });

      assert.equal(res.body.recorded, 2);
      assert.ok(res.body.groupBatchId, 'a group treatment carries a batch id');

      for (const animal of animals) {
        const fetched = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animal.id}`);
        assert.equal(fetched.body.withholdMilkUntil, daysFromNow(7));
      }
    });
  });

  test('a single-animal treatment carries no batch id', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await flock(url);
      const product = await seedAntibiotic();
      const res = await client.post<TreatmentBody>(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: iso(new Date()),
        type: 'treatment',
        productId: product._id,
        administeredBy: 'أبو سعد',
      });
      assert.equal(res.body.groupBatchId, null);
    });
  });

  test('a product outside the library is refused', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await flock(url);
      const res = await client.post<ErrorBody>(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: iso(new Date()),
        type: 'treatment',
        productId: 'not-a-real-product',
        administeredBy: 'أبو سعد',
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /not in the library/);
    });
  });

  test("another farm's animal cannot be treated", async () => {
    await withServer(testApp(), async (url) => {
      const a = await flock(url, '+966501111111');
      const b = await flock(url, '+966502222222', ['9001']);
      const product = await seedAntibiotic();

      const res = await a.client.post<ErrorBody>(`/v1/farms/${a.farmId}/health/treatments`, {
        animalIds: [b.animals[0]!.id],
        date: iso(new Date()),
        type: 'treatment',
        productId: product._id,
        administeredBy: 'أبو سعد',
      });
      assert.equal(res.status, 400, 'the animal is invisible, so there is nothing to treat');

      const untouched = await Animal.findById(b.animals[0]!.id).lean();
      assert.equal(untouched?.withholdMeatUntil, null);
    });
  });
});

describe('who is restricted', () => {
  test('milk and meat are listed separately, because they are different questions', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await flock(url);
      const antibiotic = await seedAntibiotic();
      const meatOnly = await VetProduct.create({
        nameAr: 'مضاد للديدان',
        nameEn: 'Anthelmintic',
        kind: 'anthelmintic',
        withdrawalMeatDays: 14,
        withdrawalMilkDays: 0,
        source: 'datasheet',
      });

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: iso(new Date()),
        type: 'treatment',
        productId: antibiotic._id,
        administeredBy: 'أبو سعد',
      });
      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[1]!.id],
        date: iso(new Date()),
        type: 'deworming',
        productId: meatOnly._id,
        administeredBy: 'أبو سعد',
      });

      const res = await client.get<WithdrawalBody>(`/v1/farms/${farmId}/health/withdrawal`);
      assert.equal(res.body.meat.length, 2, 'both are held from meat');
      assert.equal(res.body.milk.length, 1, 'only the antibiotic holds milk');
      assert.equal(res.body.milk[0]?.tagNumber, '1001');
      assert.equal(res.body.milk[0]?.daysLeft, 7);
    });
  });

  test('an expired restriction drops off the list', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await flock(url);
      await Animal.updateOne(
        { _id: animals[0]!.id },
        {
          $set: {
            withholdMeatUntil: new Date(Date.now() - 2 * 86_400_000),
            withholdMilkUntil: new Date(Date.now() - 2 * 86_400_000),
          },
        },
      );

      const res = await client.get<WithdrawalBody>(`/v1/farms/${farmId}/health/withdrawal`);
      assert.equal(res.body.meat.length, 0);
      assert.equal(res.body.milk.length, 0);
    });
  });

  test('the list never crosses farms', async () => {
    await withServer(testApp(), async (url) => {
      const a = await flock(url, '+966501111111');
      const b = await flock(url, '+966502222222', ['9001']);
      const product = await seedAntibiotic();

      await a.client.post(`/v1/farms/${a.farmId}/health/treatments`, {
        animalIds: [a.animals[0]!.id],
        date: iso(new Date()),
        type: 'treatment',
        productId: product._id,
        administeredBy: 'أبو سعد',
      });

      const res = await b.client.get<WithdrawalBody>(`/v1/farms/${b.farmId}/health/withdrawal`);
      assert.equal(res.body.meat.length, 0);
      assert.equal(res.body.milk.length, 0);
    });
  });
});

describe('treatment history', () => {
  test('an animal reads back its treatments, newest first, with the product named', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await flock(url);
      const product = await seedAntibiotic();

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: '2026-03-01',
        type: 'treatment',
        productId: product._id,
        administeredBy: 'أبو سعد',
      });
      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animals[0]!.id],
        date: '2026-05-01',
        type: 'vaccination',
        productId: product._id,
        administeredBy: 'البيطري',
      });

      const res = await client.get<{
        events: Array<{ date: string; type: string; productName: string; administeredBy: string }>;
      }>(`/v1/farms/${farmId}/health/animals/${animals[0]!.id}`);

      assert.equal(res.body.events.length, 2);
      assert.equal(res.body.events[0]?.date, '2026-05-01', 'newest first');
      assert.equal(res.body.events[0]?.administeredBy, 'البيطري');
      assert.match(res.body.events[0]!.productName, /Oxytetracycline/);
    });
  });

  test('the product library is readable by farm users but curated elsewhere', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await flock(url);
      await seedAntibiotic();

      const res = await client.get<{ products: Array<{ withdrawalMilkDays: number }> }>(
        `/v1/farms/${farmId}/health/products`,
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.products[0]?.withdrawalMilkDays, 7);

      // There is no farm-scoped way to create one; curation is an admin act.
      const attempt = await client.post(`/v1/farms/${farmId}/health/products`, {
        nameEn: 'Homemade',
      });
      assert.equal(attempt.status, 404);
    });
  });
});

test('a completed treatment retry repairs its saved hold without adding an event', async () => {
  await withServer(testApp(), async (url) => {
    const { client, farmId, animals } = await flock(url);
    const product = await seedAntibiotic();
    const body = {
      id: globalThis.crypto.randomUUID(),
      animalIds: [animals[0]!.id],
      date: iso(new Date()),
      type: 'treatment',
      productId: product._id,
      administeredBy: 'Test',
    };
    const first = await client.post<TreatmentBody>(`/v1/farms/${farmId}/health/treatments`, body);
    assert.equal(first.status, 201);
    await Animal.updateOne(
      { _id: animals[0]!.id },
      { $set: { withholdMeatUntil: null, withholdMilkUntil: null } },
    );
    const again = await client.post<TreatmentBody>(`/v1/farms/${farmId}/health/treatments`, body);
    assert.equal(again.status, 201);
    assert.deepEqual(again.body, first.body);
    const animal = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animals[0]!.id}`);
    assert.equal(animal.body.withholdMeatUntil, first.body.withdrawal.meatUntil);
    const history = await client.get<{ events: unknown[] }>(
      `/v1/farms/${farmId}/health/animals/${animals[0]!.id}`,
    );
    assert.equal(history.body.events.length, 1);
  });
});

test('concurrent treatments cannot shorten a longer withdrawal using a stale animal read', async () => {
  await withServer(testApp(), async (url) => {
    const { client, farmId, animals } = await flock(url);
    const product = await seedAntibiotic();
    const body = {
      animalIds: [animals[0]!.id],
      type: 'treatment',
      productId: product._id,
      administeredBy: 'Test',
    };
    const original = AnimalRepository.prototype.findById;
    let firstRead!: () => void;
    const ready = new Promise<void>((resolve) => {
      firstRead = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const spy = mock.method(AnimalRepository.prototype, 'findById', async function (...args) {
      const animal = await original.apply(this, args);
      const order = ++reads;
      if (order === 1) firstRead();
      else release();
      await gate;
      if (order === 2) await new Promise((resolve) => setTimeout(resolve, 40));
      return animal;
    });
    try {
      const longer = client.post<TreatmentBody>(`/v1/farms/${farmId}/health/treatments`, {
        ...body,
        date: daysFromNow(0),
      });
      await ready;
      const shorter = client.post<TreatmentBody>(`/v1/farms/${farmId}/health/treatments`, {
        ...body,
        date: daysFromNow(-2),
      });
      const results = await Promise.all([longer, shorter]);
      assert.ok(results.every((r) => r.status === 201));
      const animal = await Animal.findById(animals[0]!.id).lean();
      assert.equal(
        animal?.withholdMeatUntil?.toISOString().slice(0, 10),
        results[0]!.body.withdrawal.meatUntil,
      );
      assert.equal(
        animal?.withholdMilkUntil?.toISOString().slice(0, 10),
        results[0]!.body.withdrawal.milkUntil,
      );
    } finally {
      spy.mock.restore();
    }
  });
});
