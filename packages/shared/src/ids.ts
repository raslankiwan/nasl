/**
 * Client-generated identifiers.
 *
 * The device mints IDs so that a lamb recorded with no signal already has the identity its dam's
 * birth record references. Nothing is renumbered at sync time (scope §10).
 */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidId(value: string): boolean {
  return UUID_RE.test(value);
}
