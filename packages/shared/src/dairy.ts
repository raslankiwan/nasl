/**
 * What happens to the milk after it leaves the parlour.
 *
 * On a Palestinian flock a day's milk rarely has one destination. Some is sold raw at the gate,
 * some is set for white cheese (Nabulsi/Akkawi), some is soured for laban, and some goes to the
 * house. Those are not bookkeeping categories — they are different prices for the same litre, and
 * a farm that cannot compare them is guessing at the most consequential decision it makes weekly.
 *
 * This module is the arithmetic only; it holds no opinion about what a farm *should* do with a
 * litre. Yield ratios below are typicals used to sanity-check an entry, never to fabricate one.
 */

export const MILK_ROUTES = ['raw-sale', 'cheese', 'yogurt', 'home'] as const;
export type MilkRoute = (typeof MILK_ROUTES)[number];

/** Routes that turn milk into something else, and so have an output weight. */
export const PROCESSED_ROUTES: readonly MilkRoute[] = ['cheese', 'yogurt'];

export function isProcessed(route: MilkRoute): boolean {
  return PROCESSED_ROUTES.includes(route);
}

/**
 * Kilograms of sheep milk typically needed per kilogram of product.
 *
 * Sheep milk runs ~18–19% total solids against ~12% for cow, so it curds far harder: the ~4.5:1
 * figure for pressed white cheese is a sheep figure and would be badly wrong for cow milk. Goat
 * sits between the two. These are advisory bounds for catching a slipped decimal at entry — the
 * recorded output is always what the farm actually made.
 */
export const TYPICAL_CONVERSION: Record<
  'cheese' | 'yogurt',
  { low: number; typical: number; high: number }
> = {
  cheese: { low: 3.5, typical: 4.5, high: 6.5 },
  yogurt: { low: 0.95, typical: 1.0, high: 1.1 },
};

/** What the farm would expect out of `milkKg` by this route, for pre-filling and for comparison. */
export function expectedOutputKg(route: MilkRoute, milkKg: number): number | null {
  if (!isProcessed(route)) return null;
  const ratio = TYPICAL_CONVERSION[route as 'cheese' | 'yogurt'];
  return Number((milkKg / ratio.typical).toFixed(2));
}

/**
 * Is a recorded output plausible for the milk that went in?
 *
 * Returns null when there is nothing to check. `'high'` on a cheese batch usually means kilograms
 * of milk were entered as litres of curd, or a decimal moved — both worth a question at the point
 * of entry and impossible to untangle a month later.
 */
export function outputPlausibility(
  route: MilkRoute,
  milkKg: number,
  outputKg: number | null | undefined,
): 'ok' | 'low' | 'high' | null {
  if (!isProcessed(route) || outputKg == null || milkKg <= 0) return null;
  const ratio = TYPICAL_CONVERSION[route as 'cheese' | 'yogurt'];
  const actual = milkKg / outputKg;
  if (actual > ratio.high) return 'low';
  if (actual < ratio.low) return 'high';
  return 'ok';
}

export interface DispositionInput {
  route: MilkRoute;
  milkKg: number;
  outputKg?: number | null;
  revenue?: number | null;
}

export interface RouteResult {
  route: MilkRoute;
  milkKg: number;
  outputKg: number | null;
  revenue: number;
  /** What a kilogram of raw milk earned down this route. The number the comparison turns on. */
  revenuePerMilkKg: number | null;
  /** Price achieved per kilogram of product, for cheese and yogurt. */
  revenuePerOutputKg: number | null;
  batches: number;
}

export interface DispositionSummary {
  milkKg: number;
  revenue: number;
  routes: RouteResult[];
  /** Collected but not accounted for by any route. Reported, never inferred away. */
  unallocatedKg: number;
  /** The route that earned most per kilogram of raw milk, among those that earned anything. */
  bestRoute: MilkRoute | null;
}

const round = (n: number, places = 2) => Number(n.toFixed(places));

/**
 * Roll a period's dispositions up by route.
 *
 * `collectedKg` is the tank total for the same period when it is known. Milk the farm never
 * allocated shows up as `unallocatedKg` rather than being spread across the routes, because an
 * unexplained gap is a fact about the records and silently absorbing it hides a leak — literal or
 * otherwise.
 */
export function summariseDispositions(
  rows: readonly DispositionInput[],
  collectedKg?: number | null,
): DispositionSummary {
  const byRoute = new Map<MilkRoute, RouteResult>();

  for (const row of rows) {
    const current = byRoute.get(row.route) ?? {
      route: row.route,
      milkKg: 0,
      outputKg: isProcessed(row.route) ? 0 : null,
      revenue: 0,
      revenuePerMilkKg: null,
      revenuePerOutputKg: null,
      batches: 0,
    };

    current.milkKg += row.milkKg;
    current.revenue += row.revenue ?? 0;
    current.batches += 1;
    if (current.outputKg !== null) current.outputKg += row.outputKg ?? 0;
    byRoute.set(row.route, current);
  }

  const routes = [...byRoute.values()]
    .map((r) => ({
      ...r,
      milkKg: round(r.milkKg, 1),
      outputKg: r.outputKg === null ? null : round(r.outputKg, 1),
      revenue: round(r.revenue),
      revenuePerMilkKg: r.milkKg > 0 && r.revenue > 0 ? round(r.revenue / r.milkKg) : null,
      revenuePerOutputKg:
        r.outputKg !== null && r.outputKg > 0 && r.revenue > 0
          ? round(r.revenue / r.outputKg)
          : null,
    }))
    .sort((a, b) => b.milkKg - a.milkKg);

  const milkKg = routes.reduce((total, r) => total + r.milkKg, 0);
  const earning = routes.filter((r) => r.revenuePerMilkKg !== null);

  return {
    milkKg: round(milkKg, 1),
    revenue: round(routes.reduce((total, r) => total + r.revenue, 0)),
    routes,
    unallocatedKg: collectedKg == null ? 0 : round(Math.max(0, collectedKg - milkKg), 1),
    bestRoute:
      earning.length === 0
        ? null
        : earning.reduce((best, r) => (r.revenuePerMilkKg! > best.revenuePerMilkKg! ? r : best))
            .route,
  };
}
