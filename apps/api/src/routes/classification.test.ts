import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestMongo, stopTestMongo, clearDatabase } from '../testing/mongo.ts';
import { api, signInWithFarm, testApp, withServer } from '../testing/harness.ts';
import { Animal } from '../models/animal.model.ts';
import { Transaction } from '../models/finance.model.ts';
import { FinanceService } from '../services/finance.service.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';

before(() => startTestMongo(true));
after(stopTestMongo);
beforeEach(clearDatabase);
interface Row {
  id: string;
  tagNumber: string;
  classLabel: string;
  classification: string;
  status: string;
  lifecycle: unknown[];
}
const child = { species: 'sheep', sex: 'female', dateOfBirth: '2025-01-01' };

test('permanent numbers span classes, reject editing, survive retries and never recycle; class slots recycle after sale/death', async () => {
  await withServer(testApp(), async (url) => {
    const { session, farmId } = await signInWithFarm(url, 'classificationowner');
    const client = api(url, session.accessToken);
    const path = `/v1/farms/${farmId}/animals`;
    const rows = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        client.post<Row>(path, {
          ...child,
          id: randomUUID(),
          tagNumber: '500',
          classification: i % 2 ? 'mother' : 'child',
        }),
      ),
    );
    assert.ok(rows.every((row) => row.status === 201));
    assert.equal(new Set(rows.map((r) => r.body.tagNumber)).size, 12);
    assert.equal(new Set(rows.map((r) => r.body.classLabel)).size, 12);
    assert.ok(rows.every((r) => r.body.tagNumber !== '500'));
    const mother = rows.find((r) => r.body.classLabel === 'M1')!.body;
    const firstChild = rows.find((r) => r.body.classLabel === 'C1')!.body;
    assert.equal((await client.patch(`${path}/${mother.id}`, { tagNumber: '999' })).status, 400);
    assert.equal(
      (await client.patch(`${path}/${mother.id}`, { classification: 'child' })).status,
      400,
    );
    const sold = { id: randomUUID(), status: 'sold', date: '2026-01-01' };
    assert.equal((await client.post(`${path}/${mother.id}/status`, sold)).status, 200);
    assert.equal((await client.post(`${path}/${mother.id}/status`, sold)).status, 200);
    await client.post(`${path}/${firstChild.id}/status`, {
      id: randomUUID(),
      status: 'dead',
      date: '2026-01-01',
    });
    const replacement = await client.post<Row>(path, { ...child, classification: 'mother' });
    const replacementChild = await client.post<Row>(path, child);
    assert.equal(replacement.body.classLabel, 'M1');
    assert.equal(replacementChild.body.classLabel, 'C1');
    assert.notEqual(replacement.body.tagNumber, mother.tagNumber);
    assert.equal((await client.get<Row>(`${path}/${mother.id}`)).body.lifecycle.length, 1);
    assert.equal(
      (await client.post(`${path}/${mother.id}/status`, { status: 'active' })).status,
      409,
    );
    const id = randomUUID();
    const duplicate = await Promise.all([1, 2].map(() => client.post<Row>(path, { ...child, id })));
    assert.equal(duplicate[0]!.body.id, duplicate[1]!.body.id);
    assert.equal(duplicate[0]!.body.classLabel, duplicate[1]!.body.classLabel);
  });
});

test('children cannot breed; sex and species age gate promotion; parent identity and permanent number survive promotion', async () => {
  await withServer(testApp(), async (url) => {
    const { session, farmId } = await signInWithFarm(url, 'promotionowner');
    const client = api(url, session.accessToken);
    const path = `/v1/farms/${farmId}/animals`;
    const girl = (await client.post<Row>(path, child)).body;
    const boy = (await client.post<Row>(path, { ...child, sex: 'male' })).body;
    const baby = (
      await client.post<Row>(path, {
        ...child,
        dateOfBirth: new Date().toISOString().slice(0, 10),
        damId: girl.id,
      })
    ).body;
    assert.equal(
      (
        await client.post(`/v1/farms/${farmId}/breeding/matings`, {
          damId: girl.id,
          startDate: '2026-01-01',
          method: 'natural',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await client.post(`/v1/farms/${farmId}/breeding/births`, {
          damId: girl.id,
          date: '2026-06-01',
          offspring: [{ sex: 'male', outcome: 'live' }],
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await client.post(`${path}/${boy.id}/promote`, {
          id: randomUUID(),
          classification: 'mother',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await client.post(`${path}/${baby.id}/promote`, {
          id: randomUUID(),
          classification: 'mother',
        })
      ).status,
      400,
    );
    const event = { id: randomUUID(), classification: 'mother' };
    const mother = await client.post<Row>(`${path}/${girl.id}/promote`, event);
    assert.equal(mother.status, 200);
    assert.equal(mother.body.classLabel, 'M1');
    assert.equal(mother.body.tagNumber, girl.tagNumber);
    assert.equal(
      (await client.post<Row>(`${path}/${girl.id}/promote`, event)).body.lifecycle.length,
      1,
    );
    assert.equal(
      (
        await client.post<Row>(`${path}/${boy.id}/promote`, {
          id: randomUUID(),
          classification: 'male',
        })
      ).body.classLabel,
      'R1',
    );
    assert.equal(
      (await client.get<{ dam: { id: string; classLabel: string } }>(`${path}/${baby.id}/pedigree`))
        .body.dam.id,
      girl.id,
    );
    const other = await signInWithFarm(url, 'anotherowner');
    assert.equal(
      (
        await api(url, other.session.accessToken).post(
          `/v1/farms/${other.farmId}/animals/${baby.id}/promote`,
          event,
        )
      ).status,
      404,
    );
  });
});

test('sale commits money, history and released label atomically and is retry-safe', async (t) => {
  const repo = new AnimalRepository();
  const farmId = randomUUID();
  const actor = randomUUID();
  const animal = await repo.register(farmId, { species: 'sheep', sex: 'female' });
  const input = {
    id: randomUUID(),
    animalIds: [animal._id],
    amount: 700,
    date: new Date('2026-01-01'),
  };
  const finance = new FinanceService(true);
  const broken = t.mock.method(AnimalRepository.prototype, 'changeStatus', async () => {
    throw new Error('status unavailable');
  });
  await assert.rejects(() => finance.recordSale(farmId, input, actor), /status unavailable/);
  assert.equal(await Transaction.countDocuments({ farmId }), 0);
  assert.equal((await repo.findById(farmId, animal._id))?.activeClassLabel, 'C1');
  broken.mock.restore();
  const results = await Promise.all([1, 2].map(() => finance.recordSale(farmId, input, actor)));
  assert.equal(results[0]!._id, results[1]!._id);
  assert.equal(await Transaction.countDocuments({ farmId }), 1);
  assert.equal((await Animal.findById(animal._id))?.activeClassLabel, null);
  assert.equal((await repo.register(farmId, { species: 'sheep', sex: 'male' })).classLabel, 'C1');
});
