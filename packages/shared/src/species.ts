/**
 * Per-species reproductive biology.
 *
 * Every figure here is a farm-overridable default (see `farms.gestationDays` in the data model);
 * these are the values the app ships with, not constants of nature.
 */

export const SPECIES = ['sheep', 'goat'] as const;
export type Species = (typeof SPECIES)[number];

export interface SpeciesProfile {
  /** Mean gestation length in days. Sheep 145-152, goats 145-155. */
  gestationDays: number;
  /** Length of one oestrous cycle in days — used to schedule a repeat-mating check. */
  oestrousCycleDays: number;
  /** Earliest and latest day post-mating that an ultrasound scan is reliable. */
  scanWindowDays: readonly [number, number];
  /**
   * Window for the pre-lambing clostridial booster, in days of gestation.
   * Equivalent to 4-6 weeks before the due date.
   */
  preLambingBoosterDays: readonly [number, number];
  /** Typical weaning age in days from birth. */
  weaningAgeDays: readonly [number, number];
  /** Age at which a female may first be bred. */
  pubertyMonths: readonly [number, number];
  /** Days before the due date at which the ewe/doe moves to the drop pen and shows as "due". */
  dueWindowDays: number;
}

export const SPECIES_PROFILES: Record<Species, SpeciesProfile> = {
  sheep: {
    gestationDays: 147,
    oestrousCycleDays: 17,
    scanWindowDays: [45, 70],
    preLambingBoosterDays: [105, 119],
    weaningAgeDays: [60, 90],
    pubertyMonths: [6, 9],
    dueWindowDays: 14,
  },
  goat: {
    gestationDays: 150,
    oestrousCycleDays: 21,
    scanWindowDays: [45, 75],
    preLambingBoosterDays: [108, 122],
    weaningAgeDays: [60, 90],
    pubertyMonths: [6, 9],
    dueWindowDays: 14,
  },
};

export function profileFor(species: Species): SpeciesProfile {
  return SPECIES_PROFILES[species];
}
