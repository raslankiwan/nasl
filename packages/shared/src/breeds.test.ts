import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { breedsForSpecies, findBreed, isDairyBreed, SEED_BREEDS } from './breeds.ts';

describe('breed catalogue', () => {
  test('the Levantine breeds lead, because that is the launch market', () => {
    assert.equal(SEED_BREEDS[0]?.id, 'awassi');
    const firstGulfIndex = SEED_BREEDS.findIndex((b) => !b.regions.includes('levant'));
    const lastLevantIndex = SEED_BREEDS.map((b) => b.regions.includes('levant')).lastIndexOf(true);
    assert.ok(firstGulfIndex > lastLevantIndex, 'no Gulf breed sits above a Levantine one');
  });

  test('a Palestinian flock sees Awassi, Assaf and the cross, not Najdi', () => {
    const ids = breedsForSpecies('sheep', 'levant').map((b) => b.id);
    assert.deepEqual(ids, ['awassi', 'assaf', 'awassi-assaf', 'baladi-sheep']);
    assert.ok(!ids.includes('najdi'));
  });

  test('a Gulf flock sees the Gulf breeds, and Awassi which is kept in both', () => {
    const ids = breedsForSpecies('sheep', 'gulf').map((b) => b.id);
    assert.ok(ids.includes('najdi'));
    assert.ok(ids.includes('awassi'));
    assert.ok(!ids.includes('assaf'));
  });

  test('without a region the whole catalogue is returned', () => {
    assert.equal(
      breedsForSpecies('sheep').length,
      SEED_BREEDS.filter((b) => b.species === 'sheep').length,
    );
  });

  test('the dairy breeds are marked, because most of the Levantine flock is milked', () => {
    assert.equal(isDairyBreed('awassi'), true);
    assert.equal(isDairyBreed('assaf'), true);
    assert.equal(isDairyBreed('shami'), true);
    assert.equal(isDairyBreed('najdi'), false, 'the Gulf breeds are meat breeds');
  });

  test('goats carry a Baladi distinct from the sheep of the same name', () => {
    assert.equal(findBreed('baladi-goat')?.species, 'goat');
    assert.equal(findBreed('baladi-sheep')?.species, 'sheep');
  });

  test('every breed names itself in both scripts and declares a region', () => {
    for (const breed of SEED_BREEDS) {
      assert.ok(breed.nameAr.length > 0, `${breed.id} has no Arabic name`);
      assert.ok(breed.nameEn.length > 0, `${breed.id} has no English name`);
      assert.ok(breed.regions.length > 0, `${breed.id} belongs to no region`);
    }
  });
});
