import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedWeight, averageDailyGain, daysToTarget, lifetimeGain } from './growth.ts';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('average daily gain', () => {
  test('gain over a period is per day, not total', () => {
    const adg = averageDailyGain(
      { date: d('2026-03-01'), kg: 20 },
      { date: d('2026-03-31'), kg: 29 },
    );
    assert.equal(adg, 0.3, '9 kg over 30 days');
  });

  test('losing weight gives a negative gain rather than hiding it', () => {
    const adg = averageDailyGain(
      { date: d('2026-03-01'), kg: 30 },
      { date: d('2026-03-11'), kg: 28 },
    );
    assert.equal(adg, -0.2);
  });

  test('two weighings on the same day give nothing rather than dividing by zero', () => {
    assert.equal(
      averageDailyGain({ date: d('2026-03-01'), kg: 20 }, { date: d('2026-03-01'), kg: 21 }),
      null,
    );
  });

  test('lifetime gain runs from the first weighing to the last, whatever order they arrive in', () => {
    const gain = lifetimeGain([
      { date: d('2026-04-30'), kg: 32 },
      { date: d('2026-03-01'), kg: 14 },
      { date: d('2026-04-01'), kg: 25 },
    ]);
    assert.equal(gain, 0.3, '18 kg over 60 days');
  });

  test('a single weighing is not a trend', () => {
    assert.equal(lifetimeGain([{ date: d('2026-03-01'), kg: 20 }]), null);
    assert.equal(lifetimeGain([]), null);
  });
});

describe('adjusted weaning weight', () => {
  test('two lambs weighed at different ages become comparable', () => {
    const dob = d('2026-01-01');
    // Both gaining 0.25 kg/day from 4 kg, weighed at 70 and 100 days.
    const early = adjustedWeight(4, { date: d('2026-03-12'), kg: 21.5 }, dob);
    const late = adjustedWeight(4, { date: d('2026-04-11'), kg: 29 }, dob);
    assert.equal(early, 26.5);
    assert.equal(late, 26.5, 'the same lamb, judged the same way');
  });

  test('a weighing on the day of birth cannot be projected', () => {
    const dob = d('2026-01-01');
    assert.equal(adjustedWeight(4, { date: dob, kg: 4 }, dob), null);
  });

  test('the target age is configurable', () => {
    const dob = d('2026-01-01');
    assert.equal(adjustedWeight(4, { date: d('2026-03-02'), kg: 19 }, dob, 60), 19);
  });
});

describe('days to a target weight', () => {
  test('a growing animal gets a projection', () => {
    assert.equal(daysToTarget({ date: d('2026-03-01'), kg: 30 }, 0.25, 45), 60);
  });

  test('an animal already at weight is there now', () => {
    assert.equal(daysToTarget({ date: d('2026-03-01'), kg: 46 }, 0.25, 45), 0);
  });

  test('an animal that is not growing gets no projection at all', () => {
    assert.equal(daysToTarget({ date: d('2026-03-01'), kg: 30 }, 0, 45), null);
    assert.equal(
      daysToTarget({ date: d('2026-03-01'), kg: 30 }, -0.1, 45),
      null,
      'projecting a market date off a falling weight is worse than saying nothing',
    );
  });
});
