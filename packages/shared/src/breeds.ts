import type { Species } from './species.ts';

/**
 * Seed breed catalogue.
 *
 * Ordered Levant-first, because the launch market is Palestine. The Awassi is the indigenous
 * fat-tailed breed and the highest-yielding dairy sheep in the region; Assaf — an Awassi × East
 * Friesian cross — has been displacing it in the northern West Bank for its milk, and crossbreds
 * are common enough to deserve their own entry rather than being recorded as one parent or the
 * other. Gulf breeds are kept for the "then maybe Middle East" step; `regions` is what lets a farm
 * see the list that belongs to it rather than all of it.
 */
export type BreedRegion = 'levant' | 'gulf';

export interface Breed {
  id: string;
  species: Species;
  /** Canonical name in Arabic — what the herder actually says. */
  nameAr: string;
  /** Latin transliteration, for the English UI and for search. */
  nameEn: string;
  regions: readonly BreedRegion[];
  /** What the breed is principally kept for. Drives which defaults and reports matter. */
  purpose: 'dairy' | 'meat' | 'dual';
}

export const SEED_BREEDS: readonly Breed[] = [
  // ---- Levant ----
  {
    id: 'awassi',
    species: 'sheep',
    nameAr: 'عواسي',
    nameEn: 'Awassi',
    regions: ['levant', 'gulf'],
    purpose: 'dairy',
  },
  {
    id: 'assaf',
    species: 'sheep',
    nameAr: 'عساف',
    nameEn: 'Assaf',
    regions: ['levant'],
    purpose: 'dairy',
  },
  {
    id: 'awassi-assaf',
    species: 'sheep',
    nameAr: 'مخلّط (عواسي × عساف)',
    nameEn: 'Awassi × Assaf',
    regions: ['levant'],
    purpose: 'dairy',
  },
  {
    id: 'baladi-sheep',
    species: 'sheep',
    nameAr: 'بلدي',
    nameEn: 'Baladi',
    regions: ['levant'],
    purpose: 'dual',
  },
  {
    id: 'baladi-goat',
    species: 'goat',
    nameAr: 'بلدي',
    nameEn: 'Baladi',
    regions: ['levant'],
    purpose: 'dual',
  },
  {
    id: 'shami',
    species: 'goat',
    nameAr: 'شامي',
    nameEn: 'Shami (Damascus)',
    regions: ['levant', 'gulf'],
    purpose: 'dairy',
  },
  {
    id: 'jabali',
    species: 'goat',
    nameAr: 'جبلي',
    nameEn: 'Jabali (mountain)',
    regions: ['levant'],
    purpose: 'dual',
  },

  // ---- Gulf ----
  {
    id: 'najdi',
    species: 'sheep',
    nameAr: 'نجدي',
    nameEn: 'Najdi',
    regions: ['gulf'],
    purpose: 'meat',
  },
  {
    id: 'naimi',
    species: 'sheep',
    nameAr: 'نعيمي',
    nameEn: "Na'imi",
    regions: ['gulf'],
    purpose: 'meat',
  },
  {
    id: 'harri',
    species: 'sheep',
    nameAr: 'حري',
    nameEn: 'Harri',
    regions: ['gulf'],
    purpose: 'meat',
  },
  {
    id: 'sawakni',
    species: 'sheep',
    nameAr: 'سواكني',
    nameEn: 'Sawakni',
    regions: ['gulf'],
    purpose: 'meat',
  },
  {
    id: 'barbari',
    species: 'sheep',
    nameAr: 'بربري',
    nameEn: 'Barbari',
    regions: ['gulf'],
    purpose: 'meat',
  },
  {
    id: 'harfi',
    species: 'sheep',
    nameAr: 'هرفي',
    nameEn: 'Harfi',
    regions: ['gulf'],
    purpose: 'meat',
  },
  {
    id: 'ardi',
    species: 'goat',
    nameAr: 'عارضي',
    nameEn: 'Ardi',
    regions: ['gulf'],
    purpose: 'meat',
  },
  {
    id: 'hijazi',
    species: 'goat',
    nameAr: 'حجازي',
    nameEn: 'Hijazi',
    regions: ['gulf'],
    purpose: 'dual',
  },
] as const;

export function breedsForSpecies(species: Species, region?: BreedRegion): readonly Breed[] {
  return SEED_BREEDS.filter(
    (b) => b.species === species && (!region || b.regions.includes(region)),
  );
}

export function findBreed(id: string): Breed | undefined {
  return SEED_BREEDS.find((b) => b.id === id);
}

/** True when the breed is kept principally for milk — most of the Levantine flock is. */
export function isDairyBreed(id: string): boolean {
  const breed = findBreed(id);
  return breed?.purpose === 'dairy';
}
