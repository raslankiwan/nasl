import { addDays, daysBetween } from './dates.ts';
import { profileFor, type Species } from './species.ts';

/**
 * The reproductive state machine — the spine of the product (scope §6).
 *
 * A female carries exactly one state. The state advances only by applying a recorded event;
 * it is never edited directly. Terminal outcomes for the *animal* (sold, dead, culled) live on
 * `animal.status`, not here, so a culled ewe keeps her final reproductive state for reporting.
 */

export const REPRO_STATES = [
  'open', // فارغة — not pregnant, eligible to breed
  'mated', // مُلقَّحة — served, pregnancy not yet confirmed
  'pregnant', // حامل — confirmed by scan or palpation
  'due', // قريبة الولادة — inside the drop-pen window
  'lambed', // والِدة — has given birth, offspring recorded
  'nursing', // مُرضِعة — rearing offspring
  'weaned', // مفطومة — offspring weaned, recovering before next service
  'aborted', // مُجهِضة — pregnancy lost
  'barren', // عاقر — failed to conceive over N cycles
] as const;

export type ReproState = (typeof REPRO_STATES)[number];

export type ReproEvent =
  | { type: 'mating'; date: Date; species: Species }
  | { type: 'pregnancyCheck'; date: Date; result: 'pregnant' | 'open' | 'uncertain' }
  | { type: 'dueWindowReached'; date: Date }
  | { type: 'birth'; date: Date }
  | { type: 'abortion'; date: Date }
  | { type: 'nursingStarted'; date: Date }
  | { type: 'weaning'; date: Date }
  | { type: 'markedBarren'; date: Date }
  | { type: 'returnedToService'; date: Date };

export interface ReproStatus {
  state: ReproState;
  /** When the animal entered this state. */
  sinceDate: Date;
  /** The mating this state descends from, if any. */
  matingId?: string;
  /** Expected date of birth, present from `mated` until the pregnancy resolves. */
  dueDate?: Date;
}

/** States from which a new service may be recorded. */
const SERVICEABLE: ReadonlySet<ReproState> = new Set<ReproState>([
  'open',
  'weaned',
  'aborted',
  'barren',
]);

/** States in which the animal is carrying, or believed to be carrying. */
const CARRYING: ReadonlySet<ReproState> = new Set<ReproState>(['mated', 'pregnant', 'due']);

export class InvalidReproTransition extends Error {
  readonly from: ReproState;
  readonly event: ReproEvent['type'];

  constructor(from: ReproState, event: ReproEvent['type']) {
    super(`Cannot apply "${event}" to a female in state "${from}"`);
    this.name = 'InvalidReproTransition';
    this.from = from;
    this.event = event;
  }
}

/**
 * Apply one event to a reproductive status, returning the next status.
 *
 * Pure and total: it either returns a new status or throws `InvalidReproTransition`. It never
 * mutates its input, so it can run identically on the device and on the server after a sync.
 */
export function applyReproEvent(current: ReproStatus, event: ReproEvent): ReproStatus {
  const from = current.state;

  switch (event.type) {
    case 'mating': {
      if (!SERVICEABLE.has(from)) throw new InvalidReproTransition(from, event.type);
      return {
        state: 'mated',
        sinceDate: event.date,
        dueDate: expectedDueDate(event.date, event.species),
      };
    }

    case 'pregnancyCheck': {
      if (from !== 'mated' && from !== 'pregnant')
        throw new InvalidReproTransition(from, event.type);
      if (event.result === 'uncertain') return { ...current };
      if (event.result === 'open') return { state: 'open', sinceDate: event.date };
      return { ...current, state: 'pregnant', sinceDate: event.date };
    }

    case 'dueWindowReached': {
      if (from !== 'pregnant') throw new InvalidReproTransition(from, event.type);
      return { ...current, state: 'due', sinceDate: event.date };
    }

    case 'birth': {
      // A birth is accepted from `mated` too: plenty of ewes are never scanned.
      if (!CARRYING.has(from)) throw new InvalidReproTransition(from, event.type);
      return { state: 'lambed', sinceDate: event.date, matingId: current.matingId };
    }

    case 'abortion': {
      if (!CARRYING.has(from)) throw new InvalidReproTransition(from, event.type);
      return { state: 'aborted', sinceDate: event.date };
    }

    case 'nursingStarted': {
      if (from !== 'lambed') throw new InvalidReproTransition(from, event.type);
      return { state: 'nursing', sinceDate: event.date };
    }

    case 'weaning': {
      if (from !== 'nursing' && from !== 'lambed')
        throw new InvalidReproTransition(from, event.type);
      return { state: 'weaned', sinceDate: event.date };
    }

    case 'markedBarren': {
      if (from !== 'open' && from !== 'weaned') throw new InvalidReproTransition(from, event.type);
      return { state: 'barren', sinceDate: event.date };
    }

    case 'returnedToService': {
      return { state: 'open', sinceDate: event.date };
    }
  }
}

export function canApply(current: ReproStatus, event: ReproEvent): boolean {
  try {
    applyReproEvent(current, event);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Derived dates
// ---------------------------------------------------------------------------

export function expectedDueDate(matingDate: Date, species: Species): Date {
  return addDays(matingDate, profileFor(species).gestationDays);
}

/** The window in which an ultrasound scan gives a reliable result. */
export function scanWindow(matingDate: Date, species: Species): { from: Date; to: Date } {
  const [from, to] = profileFor(species).scanWindowDays;
  return { from: addDays(matingDate, from), to: addDays(matingDate, to) };
}

/** The window for the pre-lambing clostridial booster. */
export function preLambingBoosterWindow(
  matingDate: Date,
  species: Species,
): { from: Date; to: Date } {
  const [from, to] = profileFor(species).preLambingBoosterDays;
  return { from: addDays(matingDate, from), to: addDays(matingDate, to) };
}

/** The date a repeat oestrus would be observed if the service did not take. */
export function repeatOestrusDate(matingDate: Date, species: Species): Date {
  return addDays(matingDate, profileFor(species).oestrousCycleDays);
}

/** True once the animal is inside the drop-pen window before her due date. */
export function isInDueWindow(dueDate: Date, species: Species, today: Date): boolean {
  return daysBetween(today, dueDate) <= profileFor(species).dueWindowDays;
}

/** Positive while still carrying, negative once past the due date. */
export function daysUntilDue(dueDate: Date, today: Date): number {
  return daysBetween(today, dueDate);
}

/** Gestation day, counted from the mating. */
export function gestationDay(matingDate: Date, today: Date): number {
  return daysBetween(matingDate, today);
}

// ---------------------------------------------------------------------------
// What may be recorded next
// ---------------------------------------------------------------------------

/** The events a user can actually record for a female, given where she is. */
export type ReproAction = 'mating' | 'check' | 'birth' | 'weaning' | 'abortion';

const ACTIONS_BY_STATE: Record<ReproState, readonly ReproAction[]> = {
  open: ['mating'],
  weaned: ['mating'],
  aborted: ['mating'],
  barren: ['mating'],
  mated: ['check', 'birth', 'abortion'],
  pregnant: ['birth', 'abortion'],
  due: ['birth', 'abortion'],
  lambed: ['weaning'],
  nursing: ['weaning'],
};

/**
 * Offer only what the state machine will accept.
 *
 * Clients drive their menus from this rather than hard-coding a list, so a screen can never
 * present a form whose submission comes back refused. A female with no history yet is open.
 */
export function actionsFor(state: ReproState | null | undefined): readonly ReproAction[] {
  return ACTIONS_BY_STATE[state ?? 'open'] ?? [];
}
