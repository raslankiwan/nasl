import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestMongo, stopTestMongo, clearDatabase } from '../testing/mongo.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';
import { BreedingService } from './breeding.service.ts';
import { MilkService } from './milk.service.ts';
import { Animal } from '../models/animal.model.ts';
import { Birth } from '../models/breeding.model.ts';
import { Lactation } from '../models/milk.model.ts';

before(() => startTestMongo(true));
after(stopTestMongo);
beforeEach(clearDatabase);
const animals = new AnimalRepository();
const breeding = new BreedingService(true);
const actor = randomUUID();
async function fixture() {
  const farmId = randomUUID();
  const dam = await animals.register(farmId, {
    tagNumber: '100',
    species: 'sheep',
    sex: 'female',
    classification: 'mother',
    dateOfBirth: new Date('2020-01-01'),
    name: 'ريم',
  });
  await breeding.recordMating(
    farmId,
    { damId: dam._id, startDate: new Date('2026-01-01'), method: 'natural' },
    actor,
  );
  return {
    farmId,
    damId: dam._id,
    id: randomUUID(),
    date: new Date('2026-05-30'),
    offspring: [
      { sex: 'female', outcome: 'live' },
      { sex: 'male', outcome: 'live' },
    ],
  };
}
test('birth retries and concurrent duplicate submissions create one litter with unique linked numbers', async () => {
  const { farmId, ...input } = await fixture();
  const births = await Promise.all([1, 2].map(() => breeding.recordBirth(farmId, input, actor)));
  assert.equal(births[0]!._id, births[1]!._id);
  const children = await animals.offspring(farmId, input.damId);
  assert.deepEqual(children.map((child) => child.tagNumber).sort(), ['101', '102']);
  assert.equal(await Birth.countDocuments({ farmId }), 1);
  assert.equal(await Lactation.countDocuments({ farmId }), 1);
  assert.equal((await animals.ancestors(farmId, children[0]!._id))?.dam?.name, 'ريم');
  assert.deepEqual(births[0]!.offspring.map((child) => child.tagNumber).sort(), ['101', '102']);
});
test('old clients cannot assign duplicate or existing numbers to a litter', async () => {
  const { farmId, ...input } = await fixture();
  const birth = await breeding.recordBirth(
    farmId,
    {
      ...input,
      offspring: ['100', '100'].map((tagNumber) => ({ sex: 'female', outcome: 'live', tagNumber })),
    },
    actor,
  );
  assert.deepEqual(
    birth.offspring.map((child) => child.tagNumber),
    ['101', '102'],
  );
  const children = await animals.offspring(farmId, input.damId);
  assert.deepEqual(children.map((child) => child.classLabel).sort(), ['C1', 'C2']);
});
test('newborn numbers are assigned in order regardless of old client requests', async () => {
  const { farmId, ...input } = await fixture();
  const result = await breeding.recordBirth(
    farmId,
    { ...input, offspring: [input.offspring[0]!, { ...input.offspring[1]!, tagNumber: '101' }] },
    actor,
  );
  assert.deepEqual(
    result.offspring.map((child) => child.tagNumber),
    ['101', '102'],
  );
});
test('failure after creating the litter rolls back numbers, children, birth and mother state', async (t) => {
  const { farmId, ...input } = await fixture();
  const failure = t.mock.method(MilkService.prototype, 'openLactation', async () => {
    throw new Error('simulated storage failure');
  });
  await assert.rejects(
    () => breeding.recordBirth(farmId, input, actor),
    /simulated storage failure/,
  );
  assert.equal(await Animal.countDocuments({ farmId }), 1);
  assert.equal(await Birth.countDocuments({ farmId }), 0);
  assert.equal((await animals.findById(farmId, input.damId))?.repro?.state, 'mated');
  failure.mock.restore();
  const saved = await breeding.recordBirth(farmId, input, actor);
  assert.deepEqual(
    saved.offspring.map((child) => child.tagNumber),
    ['101', '102'],
  );
});
