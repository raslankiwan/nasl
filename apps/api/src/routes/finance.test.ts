import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Animal } from '../models/animal.model.ts';
import { Membership } from '../models/membership.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface AnimalBody {
  id: string;
  tagNumber: string;
  status: string;
}
interface Summary {
  currency: string;
  income: number;
  outgoings: number;
  net: number;
  animalsSold: number;
  expensesByCategory: Record<string, number>;
  feedKg: number;
  headCount: number;
  costPerHead: number | null;
}
interface ErrorBody {
  error: { message: string };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function farm(url: string, phone = '+966501111111') {
  const { session, farmId } = await signInWithFarm(url, phone);
  const client = api(url, session.accessToken);
  const bulk = await client.post<{ created: AnimalBody[] }>(`/v1/farms/${farmId}/animals/bulk`, {
    animals: [
      { tagNumber: '1001', species: 'sheep', sex: 'female' },
      { tagNumber: '1002', species: 'sheep', sex: 'female' },
    ],
  });
  return { client, farmId, animals: bulk.body.created, userId: session.user.id };
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

describe('sales', () => {
  test('a sale records the money and takes the animals off the flock', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await farm(url);

      const res = await client.post<{ animalsSold: number; currency: string }>(
        `/v1/farms/${farmId}/finance/sales`,
        {
          animalIds: [animals[0]!.id],
          amount: 1200,
          date: iso(new Date()),
          counterparty: 'أبو خالد',
        },
      );

      assert.equal(res.status, 201);
      assert.equal(res.body.animalsSold, 1);
      assert.equal(res.body.currency, 'ILS', 'the launch market currency');

      const sold = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animals[0]!.id}`);
      assert.equal(sold.body.status, 'sold');
    });
  });

  test('an animal under a meat withdrawal cannot be sold, and nothing else in the sale goes through', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await farm(url);
      await Animal.updateOne(
        { _id: animals[0]!.id },
        { $set: { withholdMeatUntil: new Date(Date.now() + 10 * 86_400_000) } },
      );

      const res = await client.post<ErrorBody>(`/v1/farms/${farmId}/finance/sales`, {
        animalIds: [animals[0]!.id, animals[1]!.id],
        amount: 2400,
        date: iso(new Date()),
      });

      assert.equal(res.status, 409);
      assert.match(res.body.error.message, /withdrawal period/);

      // The clean animal must not have been sold either — the sale is one act.
      const other = await client.get<AnimalBody>(`/v1/farms/${farmId}/animals/${animals[1]!.id}`);
      assert.equal(other.body.status, 'active');
    });
  });

  test("another farm's animal cannot be sold", async () => {
    await withServer(testApp(), async (url) => {
      const a = await farm(url, '+966501111111');
      const b = await farm(url, '+966502222222');

      const res = await a.client.post<ErrorBody>(`/v1/farms/${a.farmId}/finance/sales`, {
        animalIds: [b.animals[0]!.id],
        amount: 900,
        date: iso(new Date()),
      });
      assert.equal(res.status, 400);
    });
  });
});

describe('purchases', () => {
  test('buying animals registers them in the same action', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);

      const res = await client.post<{ animalIds: string[] }>(
        `/v1/farms/${farmId}/finance/purchases`,
        {
          amount: 3000,
          date: iso(new Date()),
          counterparty: 'سوق نابلس',
          animals: [
            { tagNumber: '7001', species: 'sheep', sex: 'female', breedId: 'awassi' },
            { tagNumber: '7002', species: 'sheep', sex: 'female', breedId: 'awassi' },
          ],
        },
      );

      assert.equal(res.status, 201);
      assert.equal(res.body.animalIds.length, 2);

      const list = await client.get<{ total: number }>(`/v1/farms/${farmId}/animals`);
      assert.equal(list.body.total, 4, 'two originals plus two bought in');

      const bought = await Animal.findById(res.body.animalIds[0]).lean();
      assert.equal(bought?.origin, 'purchased');
      assert.ok(bought?.acquiredAt, 'the day they arrived is recorded');
    });
  });
});

describe('the season ledger', () => {
  test('income, outgoings and the net come out of what was recorded', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, animals } = await farm(url);
      const date = iso(new Date());

      await client.post(`/v1/farms/${farmId}/finance/sales`, {
        animalIds: [animals[0]!.id],
        amount: 1200,
        date,
      });
      await client.post(`/v1/farms/${farmId}/finance/expenses`, {
        category: 'veterinary',
        amount: 300,
        date,
      });
      await client.post(`/v1/farms/${farmId}/finance/feed`, {
        date,
        feedType: 'شعير',
        qtyKg: 500,
        cost: 400,
      });

      const res = await client.get<Summary>(`/v1/farms/${farmId}/finance/summary`);

      assert.equal(res.body.income, 1200);
      assert.equal(res.body.outgoings, 700, 'vet plus feed');
      assert.equal(res.body.net, 500);
      assert.equal(res.body.animalsSold, 1);
      assert.equal(res.body.feedKg, 500);
      assert.equal(
        res.body.expensesByCategory.feed,
        400,
        'a feed log counts as feed spend, wherever it was entered',
      );
      assert.equal(res.body.expensesByCategory.veterinary, 300);
    });
  });

  test('cost per head uses the live flock', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      await client.post(`/v1/farms/${farmId}/finance/expenses`, {
        category: 'feed',
        amount: 500,
        date: iso(new Date()),
      });

      const res = await client.get<Summary>(`/v1/farms/${farmId}/finance/summary`);
      assert.equal(res.body.headCount, 2);
      assert.equal(res.body.costPerHead, 250);
    });
  });

  test('an empty period reports zero rather than dividing by nothing', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId } = await farm(url);
      const res = await client.get<Summary>(`/v1/farms/${farmId}/finance/summary`);
      assert.equal(res.body.income, 0);
      assert.equal(res.body.outgoings, 0);
      assert.equal(res.body.net, 0);
    });
  });

  test('a worker cannot see the money', async () => {
    await withServer(testApp(), async (url) => {
      const { client, farmId, userId } = await farm(url);
      await Membership.updateOne({ farmId, userId }, { $set: { role: 'worker' } });

      assert.equal((await client.get(`/v1/farms/${farmId}/finance/summary`)).status, 403);
      assert.equal(
        (
          await client.post(`/v1/farms/${farmId}/finance/expenses`, {
            category: 'feed',
            amount: 10,
            date: iso(new Date()),
          })
        ).status,
        403,
      );
    });
  });

  test('the ledger never crosses farms', async () => {
    await withServer(testApp(), async (url) => {
      const a = await farm(url, '+966501111111');
      const b = await farm(url, '+966502222222');
      await a.client.post(`/v1/farms/${a.farmId}/finance/expenses`, {
        category: 'feed',
        amount: 999,
        date: iso(new Date()),
      });

      const res = await b.client.get<Summary>(`/v1/farms/${b.farmId}/finance/summary`);
      assert.equal(res.body.outgoings, 0);
    });
  });
});
