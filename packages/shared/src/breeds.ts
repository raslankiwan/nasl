import type { Species } from './species.ts';

/**
 * Seed breed catalogue for the Gulf and Levant. Farms may add their own; these ship with the app
 * so the first registration screen is never an empty text box.
 */
export interface Breed {
  id: string;
  species: Species;
  /** Canonical name in Arabic — this is what the herder actually says. */
  nameAr: string;
  /** Latin transliteration, for the English UI and for search. */
  nameEn: string;
}

export const SEED_BREEDS: readonly Breed[] = [
  { id: 'najdi', species: 'sheep', nameAr: 'نجدي', nameEn: 'Najdi' },
  { id: 'naimi', species: 'sheep', nameAr: 'نعيمي', nameEn: "Na'imi" },
  { id: 'harri', species: 'sheep', nameAr: 'حري', nameEn: 'Harri' },
  { id: 'awassi', species: 'sheep', nameAr: 'عواسي', nameEn: 'Awassi' },
  { id: 'sawakni', species: 'sheep', nameAr: 'سواكني', nameEn: 'Sawakni' },
  { id: 'barbari', species: 'sheep', nameAr: 'بربري', nameEn: 'Barbari' },
  { id: 'harfi', species: 'sheep', nameAr: 'هرفي', nameEn: 'Harfi' },
  { id: 'roumi', species: 'sheep', nameAr: 'رومي', nameEn: 'Roumi' },
  { id: 'ardi', species: 'goat', nameAr: 'عارضي', nameEn: 'Ardi' },
  { id: 'shami', species: 'goat', nameAr: 'شامي', nameEn: 'Shami (Damascus)' },
  { id: 'jabali', species: 'goat', nameAr: 'جبلي', nameEn: 'Jabali' },
  { id: 'hijazi', species: 'goat', nameAr: 'حجازي', nameEn: 'Hijazi' },
  { id: 'baladi', species: 'goat', nameAr: 'بلدي', nameEn: 'Baladi' },
] as const;

export function breedsForSpecies(species: Species): readonly Breed[] {
  return SEED_BREEDS.filter((b) => b.species === species);
}

export function findBreed(id: string): Breed | undefined {
  return SEED_BREEDS.find((b) => b.id === id);
}
