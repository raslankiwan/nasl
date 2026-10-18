import { addDays, daysBetween, toDateString } from './dates.ts';

export const HEALTH_EVENT_TYPES = [
  'vaccination',
  'treatment',
  'deworming',
  'examination',
  'injury',
  'diagnosis',
] as const;
export type HealthEventType = (typeof HEALTH_EVENT_TYPES)[number];

export const ROUTES = ['intramuscular', 'subcutaneous', 'oral', 'topical', 'intravenous'] as const;
export type AdministrationRoute = (typeof ROUTES)[number];

/**
 * A veterinary product. Withdrawal periods are curated by us from manufacturer datasheets and are
 * never editable by farm users (scope FR-ADM-03) — an incorrect value here can put treated meat
 * into the food chain.
 */
export interface VeterinaryProduct {
  id: string;
  nameAr: string;
  nameEn: string;
  kind: 'vaccine' | 'antibiotic' | 'anthelmintic' | 'analgesic' | 'mineral' | 'other';
  activeIngredient?: string;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
}

export interface WithdrawalWindow {
  meatUntil?: string;
  milkUntil?: string;
}

/** Compute the withhold-until dates a treatment imposes. Zero-day periods produce no restriction. */
export function withdrawalFor(
  product: Pick<VeterinaryProduct, 'withdrawalMeatDays' | 'withdrawalMilkDays'>,
  administeredOn: Date,
): WithdrawalWindow {
  const window: WithdrawalWindow = {};
  if (product.withdrawalMeatDays > 0) {
    window.meatUntil = toDateString(addDays(administeredOn, product.withdrawalMeatDays));
  }
  if (product.withdrawalMilkDays > 0) {
    window.milkUntil = toDateString(addDays(administeredOn, product.withdrawalMilkDays));
  }
  return window;
}

/**
 * When two treatments overlap, the animal is restricted until the later of the two dates.
 * Always widen, never replace.
 */
export function mergeWithdrawal(a: WithdrawalWindow, b: WithdrawalWindow): WithdrawalWindow {
  const later = (x?: string, y?: string) => (!x ? y : !y ? x : x > y ? x : y);
  return { meatUntil: later(a.meatUntil, b.meatUntil), milkUntil: later(a.milkUntil, b.milkUntil) };
}

/** Notifiable and common small-ruminant diseases in the target region. */
export const SEED_DISEASES = [
  { id: 'ppr', nameAr: 'طاعون المجترات الصغيرة', nameEn: 'Peste des Petits Ruminants (PPR)' },
  { id: 'sheep-pox', nameAr: 'جدري الأغنام', nameEn: 'Sheep pox' },
  { id: 'fmd', nameAr: 'الحمى القلاعية', nameEn: 'Foot and mouth disease' },
  { id: 'enterotoxaemia', nameAr: 'التسمم المعوي', nameEn: 'Enterotoxaemia (clostridial)' },
  { id: 'brucellosis', nameAr: 'البروسيلا', nameEn: 'Brucellosis' },
  { id: 'pasteurellosis', nameAr: 'الباستوريلا', nameEn: 'Pasteurellosis' },
  { id: 'mange', nameAr: 'الجرب', nameEn: 'Mange' },
  { id: 'internal-parasites', nameAr: 'الديدان الداخلية', nameEn: 'Internal parasites' },
  { id: 'mastitis', nameAr: 'التهاب الضرع', nameEn: 'Mastitis' },
  { id: 'foot-rot', nameAr: 'تعفن الحوافر', nameEn: 'Foot rot' },
] as const;

/** The final calendar day is still restricted; historical dates remain on the record. */
export function isWithdrawalActive(
  until: string | Date | null | undefined,
  today = new Date(),
): boolean {
  return Boolean(until && daysBetween(today, new Date(until)) >= 0);
}
