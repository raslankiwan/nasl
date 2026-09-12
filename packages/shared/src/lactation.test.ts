import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  averageDailyYield,
  daysInMilk,
  lactationYield,
  peakYield,
  standardisedYield,
  STANDARD_LACTATION_DAYS,
} from './lactation.ts';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const LAMBED = d('2026-01-01');

describe('lactation yield from test days', () => {
  test('a worked lactation matches the Fleischmann calculation by hand', () => {
    // Tests at days 30, 60 and 90; dried off at day 150.
    //   lambing→30:  30 × 2.0            =  60
    //   30→60:       30 × (2.0+2.4)/2    =  66
    //   60→90:       30 × (2.4+1.8)/2    =  63
    //   90→150:      60 × 1.8            = 108
    const total = lactationYield(
      LAMBED,
      [
        { date: d('2026-01-31'), kg: 2.0 },
        { date: d('2026-03-02'), kg: 2.4 },
        { date: d('2026-04-01'), kg: 1.8 },
      ],
      d('2026-05-31'),
    );
    assert.equal(total, 297);
  });

  test('the result lands in the range reported for Awassi flocks', () => {
    const total = lactationYield(
      LAMBED,
      [
        { date: d('2026-01-31'), kg: 2.0 },
        { date: d('2026-03-02'), kg: 2.4 },
        { date: d('2026-04-01'), kg: 1.8 },
      ],
      d('2026-05-31'),
    );
    assert.ok(total >= 125 && total <= 330, `${total} kg over 150 days`);
  });

  test('a single test day holds that rate across the whole lactation', () => {
    const total = lactationYield(LAMBED, [{ date: d('2026-02-01'), kg: 2 }], d('2026-03-03'));
    assert.equal(total, 122, '61 days at 2 kg — the best the one measurement supports');
  });

  test('no test days means no estimate, not a zero pretending to be one', () => {
    assert.equal(lactationYield(LAMBED, [], d('2026-05-31')), 0);
  });

  test('test days arriving out of order are sorted before estimating', () => {
    const points = [
      { date: d('2026-04-01'), kg: 1.8 },
      { date: d('2026-01-31'), kg: 2.0 },
      { date: d('2026-03-02'), kg: 2.4 },
    ];
    assert.equal(lactationYield(LAMBED, points, d('2026-05-31')), 297);
  });

  test('a test recorded before she lambed is ignored', () => {
    const total = lactationYield(
      LAMBED,
      [
        { date: d('2025-12-01'), kg: 9 },
        { date: d('2026-01-31'), kg: 2.0 },
      ],
      d('2026-01-31'),
    );
    assert.equal(total, 60, 'only the real one counts');
  });
});

describe('standardised yield', () => {
  test('two ewes that lambed months apart become comparable', () => {
    const points = [
      { date: d('2026-01-31'), kg: 2.0 },
      { date: d('2026-03-02'), kg: 2.4 },
      { date: d('2026-04-01'), kg: 1.8 },
    ];
    // Milked well past the standard length; only the first 150 days count.
    const standard = standardisedYield(LAMBED, points, d('2026-08-01'));
    assert.equal(standard, 297);
  });

  test('a lactation cut short is not extrapolated to flatter her', () => {
    const points = [{ date: d('2026-01-31'), kg: 2.0 }];
    const standard = standardisedYield(LAMBED, points, d('2026-03-02'));
    assert.equal(standard, 120, '60 days at 2 kg, and drying off early is the point');
    assert.ok(standard < 2 * STANDARD_LACTATION_DAYS);
  });
});

describe('other lactation figures', () => {
  test('peak is the highest measured day', () => {
    assert.equal(
      peakYield([
        { date: d('2026-01-31'), kg: 2.0 },
        { date: d('2026-03-02'), kg: 2.4 },
      ]),
      2.4,
    );
    assert.equal(peakYield([]), null);
  });

  test('days in milk counts from lambing', () => {
    assert.equal(daysInMilk(LAMBED, d('2026-05-31')), 150);
    assert.equal(daysInMilk(LAMBED, d('2025-12-01')), 0, 'never negative');
  });

  test('average daily yield is the lactation over its length', () => {
    const avg = averageDailyYield(LAMBED, [{ date: d('2026-01-31'), kg: 2 }], d('2026-03-02'));
    assert.equal(avg, 2, 'a flat lactation averages its rate');
  });

  test('a lactation that started today has no average yet', () => {
    assert.equal(averageDailyYield(LAMBED, [{ date: LAMBED, kg: 2 }], LAMBED), null);
  });
});
