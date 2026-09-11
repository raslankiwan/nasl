/**
 * Registers every model with Mongoose.
 *
 * Index creation walks `mongoose.models`, so a model that no route happens to import would never
 * get its indexes built. Importing them all in one place makes that impossible to get wrong.
 */
export * from './animal.model.ts';
export * from './auditLog.model.ts';
export * from './base.ts';
export * from './breeding.model.ts';
export * from './farm.model.ts';
export * from './finance.model.ts';
export * from './group.model.ts';
export * from './health.model.ts';
export * from './membership.model.ts';
export * from './movement.model.ts';
export * from './otpChallenge.model.ts';
export * from './refreshToken.model.ts';
export * from './user.model.ts';
export * from './vetProduct.model.ts';
export * from './weight.model.ts';
