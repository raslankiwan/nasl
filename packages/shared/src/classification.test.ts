import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adultEligibleOn, classificationError } from './classification.ts';

test('species age gate includes the exact eligible day and clamps month ends', () => {
  for (const species of ['sheep', 'goat'] as const) {
    const female = { species, sex: 'female', dateOfBirth: '2026-01-31' };
    assert.equal(adultEligibleOn(species, female.dateOfBirth), '2026-07-31');
    assert.equal(classificationError(female, 'mother', '2026-07-30'), 'classification_age');
    assert.equal(classificationError(female, 'mother', '2026-07-31'), null);
    assert.equal(adultEligibleOn(species, '2025-08-31'), '2026-02-28');
    assert.equal(classificationError({ species, sex: 'female' }, 'mother'), 'birth_date_required');
    assert.equal(classificationError({ ...female, sex: 'male' }, 'mother'), 'classification_sex');
    assert.equal(classificationError({ ...female, sex: 'male' }, 'male', '2026-07-31'), null);
  }
});
