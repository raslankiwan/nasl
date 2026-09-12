import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { VetProduct } from '../models/vetProduct.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface Item {
  id: string;
  productName: string;
  batchNo: string;
  qtyRemaining: number;
  qtyInitial: number;
  daysToExpiry: number;
  expired: boolean;
  expiringSoon: boolean;
  lowStock: boolean;
}
interface ErrorBody {
  error: { message: string };
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function shelf(url: string, phone = '+966501111111') {
  const { session, farmId } = await signInWithFarm(url, phone);
  const client = api(url, session.accessToken);
  const product = await VetProduct.create({
    nameAr: 'أوكسي تتراسيكلين',
    nameEn: 'Oxytetracycline',
    kind: 'antibiotic',
    withdrawalMeatDays: 28,
    withdrawalMilkDays: 7,
    source: 'datasheet',
  });
  const animal = await client.post<{ id: string }>(`/v1/farms/${farmId}/animals`, {
    tagNumber: '1001',
    species: 'sheep',
    sex: 'female',
  });
  return { client, farmId, productId: product._id, animalId: animal.body.id };
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

describe('receiving stock', () => {
  test('a bottle goes on the shelf under its batch number', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, productId } = await shelf(url);

      const res = await client.post<Item>(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'LOT-42',
        expiry: inDays(400),
        quantity: 250,
        unit: 'ml',
        supplier: 'صيدلية بيطرية',
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.batchNo, 'LOT-42');
      assert.equal(res.body.qtyRemaining, 250);
    });
  });

  test('the same batch arriving again tops up rather than duplicating the row', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, productId } = await shelf(url);
      const bottle = { productId, batchNo: 'LOT-42', expiry: inDays(400), quantity: 250 };

      await client.post(`/v1/farms/${farmId}/inventory`, bottle);
      await client.post(`/v1/farms/${farmId}/inventory`, bottle);

      const list = await client.get<{ items: Item[] }>(`/v1/farms/${farmId}/inventory`);
      assert.equal(list.body.items.length, 1);
      assert.equal(list.body.items[0]?.qtyRemaining, 500);
    });
  });

  test('two batches of the same product are separate rows, because a recall asks by batch', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, productId } = await shelf(url);
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'LOT-42',
        expiry: inDays(400),
        quantity: 250,
      });
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'LOT-43',
        expiry: inDays(500),
        quantity: 250,
      });

      const list = await client.get<{ items: Item[] }>(`/v1/farms/${farmId}/inventory`);
      assert.equal(list.body.items.length, 2);
    });
  });

  test('a product outside the library cannot be stocked', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await shelf(url);
      const res = await client.post<ErrorBody>(`/v1/farms/${farmId}/inventory`, {
        productId: 'not-real',
        batchNo: 'LOT-1',
        expiry: inDays(100),
        quantity: 10,
      });
      assert.equal(res.status, 400);
    });
  });
});

describe('what needs attention', () => {
  test('an expired bottle, one expiring soon and one low on stock are each flagged', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, productId } = await shelf(url);

      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'OLD',
        expiry: inDays(-5),
        quantity: 100,
      });
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'SOON',
        expiry: inDays(30),
        quantity: 100,
      });
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'FINE',
        expiry: inDays(400),
        quantity: 100,
      });

      const res = await client.get<{
        expired: Item[];
        expiringSoon: Item[];
        lowStock: Item[];
      }>(`/v1/farms/${farmId}/inventory/warnings`);

      assert.deepEqual(
        res.body.expired.map((i) => i.batchNo),
        ['OLD'],
      );
      assert.deepEqual(
        res.body.expiringSoon.map((i) => i.batchNo),
        ['SOON'],
      );
      assert.equal(res.body.lowStock.length, 0, 'all three are still full');
    });
  });

  test('the shelf is ordered by what expires first', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, productId } = await shelf(url);
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'LATER',
        expiry: inDays(400),
        quantity: 100,
      });
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'SOONER',
        expiry: inDays(40),
        quantity: 100,
      });

      const list = await client.get<{ items: Item[] }>(`/v1/farms/${farmId}/inventory`);
      assert.deepEqual(
        list.body.items.map((i) => i.batchNo),
        ['SOONER', 'LATER'],
      );
    });
  });
});

describe('treatments draw from the shelf', () => {
  test('a dose comes off the batch it was given from', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, productId, animalId } = await shelf(url);
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'LOT-42',
        expiry: inDays(400),
        quantity: 250,
      });

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animalId],
        date: iso(new Date()),
        type: 'treatment',
        productId,
        batchNo: 'LOT-42',
        doseValue: 10,
        doseUnit: 'ml',
        administeredBy: 'البيطري',
      });

      const list = await client.get<{ items: Item[] }>(`/v1/farms/${farmId}/inventory`);
      assert.equal(list.body.items[0]?.qtyRemaining, 240);
    });
  });

  test('a whole pen treated together takes a dose per animal', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, productId } = await shelf(url);
      const bulk = await client.post<{ created: Array<{ id: string }> }>(
        `/v1/farms/${farmId}/animals/bulk`,
        {
          animals: [
            { tagNumber: '2001', species: 'sheep', sex: 'female' },
            { tagNumber: '2002', species: 'sheep', sex: 'female' },
            { tagNumber: '2003', species: 'sheep', sex: 'female' },
          ],
        },
      );
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'LOT-42',
        expiry: inDays(400),
        quantity: 250,
      });

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: bulk.body.created.map((a) => a.id),
        date: iso(new Date()),
        type: 'treatment',
        productId,
        batchNo: 'LOT-42',
        doseValue: 10,
        administeredBy: 'البيطري',
      });

      const list = await client.get<{ items: Item[] }>(`/v1/farms/${farmId}/inventory`);
      assert.equal(list.body.items[0]?.qtyRemaining, 220, '30 ml for three head');
    });
  });

  test('with no batch given, the dose comes off the bottle expiring soonest', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, productId, animalId } = await shelf(url);
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'LATER',
        expiry: inDays(400),
        quantity: 100,
      });
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'SOONER',
        expiry: inDays(40),
        quantity: 100,
      });

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animalId],
        date: iso(new Date()),
        type: 'treatment',
        productId,
        doseValue: 10,
        administeredBy: 'البيطري',
      });

      const list = await client.get<{ items: Item[] }>(`/v1/farms/${farmId}/inventory`);
      const sooner = list.body.items.find((i) => i.batchNo === 'SOONER');
      assert.equal(sooner?.qtyRemaining, 90, 'the bottle you would actually reach for');
    });
  });

  test('a treatment is never refused because the shelf is empty or untracked', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, productId, animalId } = await shelf(url);

      // Nothing stocked at all — a herder who does not keep stock must still record the treatment.
      const res = await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animalId],
        date: iso(new Date()),
        type: 'treatment',
        productId,
        doseValue: 10,
        administeredBy: 'البيطري',
      });
      assert.equal(res.status, 201);
    });
  });

  test('the shelf stops at zero rather than going negative', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, productId, animalId } = await shelf(url);
      await client.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: 'LOT-42',
        expiry: inDays(400),
        quantity: 5,
      });

      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animalId],
        date: iso(new Date()),
        type: 'treatment',
        productId,
        batchNo: 'LOT-42',
        doseValue: 50,
        administeredBy: 'البيطري',
      });

      const list = await client.get<{ items: Item[] }>(`/v1/farms/${farmId}/inventory`);
      assert.equal(list.body.items[0]?.qtyRemaining, 0, 'a negative shelf helps nobody');
    });
  });

  test('the shelf never crosses farms', async () => {
    await withServer(testApp(), async (url) => {
      const a = await shelf(url, '+966501111111');
      const b = await shelf(url, '+966502222222');
      await a.client.post(`/v1/farms/${a.farmId}/inventory`, {
        productId: a.productId,
        batchNo: 'LOT-42',
        expiry: inDays(400),
        quantity: 250,
      });

      const list = await b.client.get<{ items: Item[] }>(`/v1/farms/${b.farmId}/inventory`);
      assert.equal(list.body.items.length, 0);
    });
  });
});
