import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedOutputKg,
  isProcessed,
  outputPlausibility,
  summariseDispositions,
} from './dairy.ts';

describe('conversion expectations', () => {
  test('cheese takes several kilos of milk per kilo of curd; yogurt is near one to one', () => {
    assert.equal(expectedOutputKg('cheese', 45), 10);
    assert.equal(expectedOutputKg('yogurt', 45), 45);
  });

  test('milk sold as it left the parlour has no output weight', () => {
    assert.equal(expectedOutputKg('raw-sale', 45), null);
    assert.equal(expectedOutputKg('home', 10), null);
    assert.equal(isProcessed('raw-sale'), false);
  });
});

describe('catching a slipped decimal at the point of entry', () => {
  test('a normal cheese batch passes', () => {
    assert.equal(outputPlausibility('cheese', 45, 10), 'ok');
  });

  test('ten kilos of cheese from twelve kilos of milk is flagged, not stored silently', () => {
    assert.equal(outputPlausibility('cheese', 12, 10), 'high');
  });

  test('one kilo of cheese from forty-five kilos of milk is flagged the other way', () => {
    assert.equal(outputPlausibility('cheese', 45, 1), 'low');
  });

  test('nothing to check when the route has no output or the batch is empty', () => {
    assert.equal(outputPlausibility('raw-sale', 45, null), null);
    assert.equal(outputPlausibility('cheese', 45, null), null);
    assert.equal(outputPlausibility('cheese', 0, 10), null);
  });
});

describe('comparing what a litre earned by route', () => {
  const week = [
    { route: 'raw-sale' as const, milkKg: 60, revenue: 300 },
    { route: 'cheese' as const, milkKg: 90, outputKg: 20, revenue: 700 },
    { route: 'yogurt' as const, milkKg: 30, outputKg: 29, revenue: 145 },
    { route: 'home' as const, milkKg: 20 },
  ];

  test('cheese earned most per kilogram of raw milk', () => {
    const summary = summariseDispositions(week);
    // raw 300/60 = 5.00, cheese 700/90 = 7.78, yogurt 145/30 = 4.83.
    assert.equal(summary.bestRoute, 'cheese');
    const cheese = summary.routes.find((r) => r.route === 'cheese')!;
    assert.equal(cheese.revenuePerMilkKg, 7.78);
    assert.equal(cheese.revenuePerOutputKg, 35);
  });

  test('milk the family drank earns nothing and never wins the comparison', () => {
    const summary = summariseDispositions(week);
    const home = summary.routes.find((r) => r.route === 'home')!;
    assert.equal(home.revenue, 0);
    assert.equal(home.revenuePerMilkKg, null);
  });

  test('totals cover every route including the unsold ones', () => {
    const summary = summariseDispositions(week);
    assert.equal(summary.milkKg, 200);
    assert.equal(summary.revenue, 1145);
    assert.equal(summary.routes.length, 4);
  });

  test('batches down the same route are added, not listed twice', () => {
    const summary = summariseDispositions([
      { route: 'cheese', milkKg: 45, outputKg: 10, revenue: 350 },
      { route: 'cheese', milkKg: 45, outputKg: 10, revenue: 350 },
    ]);
    assert.equal(summary.routes.length, 1);
    assert.equal(summary.routes[0]!.batches, 2);
    assert.equal(summary.routes[0]!.milkKg, 90);
    assert.equal(summary.routes[0]!.outputKg, 20);
  });

  test('milk collected but never allocated is reported, not spread across the routes', () => {
    const summary = summariseDispositions(week, 230);
    assert.equal(summary.unallocatedKg, 30);
    assert.equal(summary.milkKg, 200);
  });

  test('allocating more than the tank held does not produce a negative gap', () => {
    const summary = summariseDispositions(week, 150);
    assert.equal(summary.unallocatedKg, 0);
  });

  test('a week with no sales has no best route', () => {
    const summary = summariseDispositions([{ route: 'home', milkKg: 40 }]);
    assert.equal(summary.bestRoute, null);
  });
});
