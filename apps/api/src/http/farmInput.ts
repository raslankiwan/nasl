import { z } from 'zod';
import { SPECIES } from '@nasl/shared';

export const createFarmSchema = z.object({
  name: z.string().trim().min(1).max(120),
  country: z.string().length(2).default('PS'),
  currency: z.string().length(3).default('ILS'),
  timezone: z.string().min(1).default('Asia/Hebron'),
  species: z.array(z.enum(SPECIES)).min(1).default(['sheep']),
  calendarPreference: z.enum(['hijri', 'gregorian']).default('gregorian'),
});
