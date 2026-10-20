import type { AnimalClass } from './classification.ts';
import type { Species } from './species.ts';
import type { ReproStatus } from './repro.ts';

export const SEXES = ['female', 'male'] as const;
export type Sex = (typeof SEXES)[number];

/** How the animal joined this farm. */
export const ORIGINS = ['born', 'purchased', 'gifted', 'transferred'] as const;
export type Origin = (typeof ORIGINS)[number];

/**
 * Animal lifecycle status. Every value except `active` is terminal for day-to-day work, but the
 * record is retained forever — it is an ancestor in someone's pedigree.
 */
export const ANIMAL_STATUSES = ['active', 'sold', 'slaughtered', 'dead', 'culled', 'lost'] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

export interface Animal {
  id: string;
  farmId: string;
  tagNumber: string;
  classification?: AnimalClass;
  classLabel?: string | null;
  /** Electronic (RFID) tag, when the farm uses EID. */
  eid?: string;
  name?: string;
  species: Species;
  breedId?: string;
  sex: Sex;
  dateOfBirth?: string;
  /** True when the date of birth was estimated from dentition rather than recorded at birth. */
  dobIsEstimate: boolean;
  colour?: string;
  origin: Origin;
  acquiredAt?: string;
  damId?: string;
  sireId?: string;
  currentGroupId?: string;
  status: AnimalStatus;
  /** Derived from the event stream — never written directly. Females only. */
  repro?: ReproStatus;
  lastWeightKg?: number;
  /** Set by a treatment; blocks sale or slaughter until passed. */
  withholdMeatUntil?: string;
  withholdMilkUntil?: string;
  photoKeys: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** Only females carry a reproductive state. */
export function isBreedingFemale(
  animal: Pick<Animal, 'sex' | 'status' | 'classification'>,
): boolean {
  return (
    animal.sex === 'female' && animal.status === 'active' && animal.classification === 'mother'
  );
}

/** True while a treatment withdrawal period blocks the animal leaving the farm for meat. */
export function isUnderMeatWithdrawal(
  animal: Pick<Animal, 'withholdMeatUntil'>,
  today: Date,
): boolean {
  if (!animal.withholdMeatUntil) return false;
  return new Date(animal.withholdMeatUntil).getTime() >= today.getTime();
}

export function isUnderMilkWithdrawal(
  animal: Pick<Animal, 'withholdMilkUntil'>,
  today: Date,
): boolean {
  if (!animal.withholdMilkUntil) return false;
  return new Date(animal.withholdMilkUntil).getTime() >= today.getTime();
}
