import { model } from 'mongoose';
import { tenantSchema, type TenantDocument } from './base.ts';

export interface AnimalNumberDoc extends TenantDocument {
  lastNumber: number;
}
const schema = tenantSchema<AnimalNumberDoc>({
  lastNumber: { type: Number, required: true, min: 0 },
});
schema.index({ farmId: 1 }, { unique: true, name: 'farm_animal_number_sequence' });
export const AnimalNumber = model<AnimalNumberDoc>('AnimalNumber', schema);
