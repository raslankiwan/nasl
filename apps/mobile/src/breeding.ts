import type { ReproAction } from '@nasl/shared';

/**
 * UI wiring for the reproductive actions. Which actions are *possible* is domain logic and lives
 * in `@nasl/shared` (`actionsFor`); this only says where each one goes and what to call it.
 */
export const ACTION_ROUTES: Record<ReproAction, string> = {
  mating: '/breeding/mating',
  check: '/breeding/check',
  birth: '/breeding/birth',
  weaning: '/breeding/weaning',
  abortion: '/breeding/abortion',
};

/** Translation key for each action's button, in the `breeding` namespace. */
export const ACTION_LABELS: Record<ReproAction, string> = {
  mating: 'breeding:recordMating',
  check: 'breeding:pregnancyCheck',
  birth: 'breeding:recordBirth',
  weaning: 'breeding:weaning',
  abortion: 'breeding:abortion',
};
