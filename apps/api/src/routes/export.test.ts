import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { UTF8_BOM } from '@nasl/shared';
import { Membership } from '../models/membership.model.ts';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';

interface AnimalBody {
  id: string;
  tagNumber: string;
}

/**
 * The export endpoints return text, not JSON, so they need a raw fetch.
 *
 * Read as bytes rather than `res.text()`: the fetch specification strips a leading UTF-8 BOM when
 * decoding, which would hide the very thing that decides whether Excel opens the file correctly.
 */
async function getText(url: string, path: string, token: string) {
  const res = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    status: res.status,
    headers: res.headers,
    bytes,
    body: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes),
  };
}

async function farm(url: string, phone = '+966501111111') {
  const { session, farmId } = await signInWithFarm(url, phone);
  return {
    client: api(url, session.accessToken),
    token: session.accessToken,
    farmId,
    userId: session.user.id,
  };
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

describe('flock export', () => {
  test('the file opens correctly in Excel and carries the Arabic through', async () => {
    await withServer(testApp(), async (url) => {
      const { client, token, farmId } = await farm(url);
      await client.post(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        name: 'غزال',
        species: 'sheep',
        sex: 'female',
        breedId: 'awassi',
      });

      const res = await getText(url, `/v1/farms/${farmId}/export/flock.csv`, token);

      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
      assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
      assert.deepEqual(
        [...res.bytes.slice(0, 3)],
        [0xef, 0xbb, 0xbf],
        'without the BOM Excel mangles every Arabic name',
      );
      assert.ok(res.body.startsWith(UTF8_BOM));
      assert.ok(res.body.includes('غزال'));
      assert.ok(res.body.includes('awassi'));
    });
  });

  test('parents are named by their tag, not by an id nobody can read', async () => {
    await withServer(testApp(), async (url) => {
      const { client, token, farmId } = await farm(url);
      const dam = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
        dateOfBirth: '2022-01-01',
      });
      await client.post(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1002',
        species: 'sheep',
        sex: 'female',
        dateOfBirth: '2024-01-01',
        damId: dam.body.id,
      });

      const res = await getText(url, `/v1/farms/${farmId}/export/flock.csv`, token);
      const lamb = res.body.split('\r\n').find((line) => line.startsWith('2,'))!;
      assert.ok(lamb.includes('1'), 'the dam appears as her tag');
      assert.ok(!lamb.includes(dam.body.id), 'and not as a uuid');
    });
  });

  test('a name that looks like a formula cannot execute when the file is opened', async () => {
    await withServer(testApp(), async (url) => {
      const { client, token, farmId } = await farm(url);
      await client.post(`/v1/farms/${farmId}/animals`, {
        name: '=1+1',
        species: 'sheep',
        sex: 'female',
      });

      const res = await getText(url, `/v1/farms/${farmId}/export/flock.csv`, token);
      assert.ok(res.body.includes('"\t=1+1"'), 'the cell is defused and quoted');
    });
  });

  test('the export never crosses farms', async () => {
    await withServer(testApp(), async (url) => {
      const a = await farm(url, '+966501111111');
      const b = await farm(url, '+966502222222');
      await a.client.post(`/v1/farms/${a.farmId}/animals`, {
        tagNumber: '1001',
        name: 'غزال',
        species: 'sheep',
        sex: 'female',
      });

      const res = await getText(url, `/v1/farms/${b.farmId}/export/flock.csv`, b.token);
      assert.ok(!res.body.includes('غزال'));
      assert.ok(!res.body.includes('1001'));
    });
  });

  test('a worker cannot export the flock', async () => {
    await withServer(testApp(), async (url) => {
      const { token, farmId, userId } = await farm(url);
      await Membership.updateOne({ farmId, userId }, { $set: { role: 'worker' } });

      const res = await getText(url, `/v1/farms/${farmId}/export/flock.csv`, token);
      assert.equal(res.status, 403);
    });
  });
});

describe('treatment register export', () => {
  test('every medicine given appears with its batch and withdrawal dates', async () => {
    await withServer(testApp(), async (url) => {
      const { client, token, farmId } = await farm(url);
      const { VetProduct } = await import('../models/vetProduct.model.ts');
      const product = await VetProduct.create({
        nameAr: 'أوكسي تتراسيكلين',
        nameEn: 'Oxytetracycline',
        kind: 'antibiotic',
        withdrawalMeatDays: 28,
        withdrawalMilkDays: 7,
        source: 'datasheet',
      });
      const animal = await client.post<AnimalBody>(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });
      await client.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: [animal.body.id],
        date: new Date().toISOString().slice(0, 10),
        type: 'treatment',
        productId: product._id,
        batchNo: 'LOT-42',
        administeredBy: 'البيطري',
      });

      const res = await getText(url, `/v1/farms/${farmId}/export/treatments.csv`, token);
      assert.ok(res.body.includes('LOT-42'));
      assert.ok(res.body.includes('البيطري'));
      assert.ok(res.body.includes('Oxytetracycline'));
    });
  });
});

describe('full export', () => {
  test('the customer can take everything with them', async () => {
    await withServer(testApp(), async (url) => {
      const { client, token, farmId } = await farm(url);
      await client.post(`/v1/farms/${farmId}/animals`, {
        tagNumber: '1001',
        species: 'sheep',
        sex: 'female',
      });

      const res = await fetch(`${url}/v1/farms/${farmId}/export/full.json`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as Record<string, unknown[]> & { schemaVersion: number };

      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition') ?? '', /nasl-export\.json/);
      assert.equal(body.schemaVersion, 1);
      // Every collection is present, even the empty ones, so the shape is predictable.
      for (const key of [
        'animals',
        'groups',
        'matings',
        'pregnancyChecks',
        'births',
        'weanings',
        'abortions',
        'healthEvents',
        'weights',
      ]) {
        assert.ok(Array.isArray(body[key]), `${key} is missing from the export`);
      }
      assert.equal(body.animals.length, 1);
    });
  });
});
