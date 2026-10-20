import { profileFor, type Species } from './species.ts';

export const ANIMAL_CLASSES = ['mother', 'child', 'male'] as const;
export type AnimalClass = (typeof ANIMAL_CLASSES)[number];
export const CLASS_PREFIX: Record<AnimalClass, string> = { mother: 'M', child: 'C', male: 'R' };

export function animalLabel(animal: { classLabel?: string | null; tagNumber: string }): string {
  return animal.classLabel || animal.tagNumber;
}

/** A product eligibility floor using the existing species profile, not a breeding recommendation. */
export function adultEligibleOn(species: Species, dateOfBirth: string | Date): string | null {
  const born = new Date(dateOfBirth);
  if (!Number.isFinite(born.getTime())) return null;
  const month = born.getUTCMonth() + profileFor(species).pubertyMonths[0];
  const lastDay = new Date(Date.UTC(born.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(born.getUTCFullYear(), month, Math.min(born.getUTCDate(), lastDay)))
    .toISOString()
    .slice(0, 10);
}

export function classificationError(
  animal: { sex: string; species: string; dateOfBirth?: string | Date | null },
  classification: AnimalClass,
  today = new Date().toISOString().slice(0, 10),
): 'classification_sex' | 'birth_date_required' | 'classification_age' | null {
  if (
    (classification === 'mother' && animal.sex !== 'female') ||
    (classification === 'male' && animal.sex !== 'male')
  )
    return 'classification_sex';
  if (classification === 'child') return null;
  if (!animal.dateOfBirth) return 'birth_date_required';
  const eligible = adultEligibleOn(animal.species as Species, animal.dateOfBirth);
  return eligible && eligible <= today ? null : 'classification_age';
}
