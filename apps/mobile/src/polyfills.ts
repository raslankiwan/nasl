import { uuid } from 'expo-modules-core';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * `crypto.randomUUID` in the React Native runtime.
 *
 * Hermes ships no `crypto` global, and every id in this app is minted on the device before any
 * network attempt (scope §10) — so without this, `newId()` throws the first time a herder records
 * anything, and sign-in dies on the device id. Node and the browser have their own, so this only
 * fills a gap it finds.
 *
 * The generator is expo-modules-core's native UUID v4, already present through `expo`. A
 * `Math.random` shim would be the wrong trade for identifiers that have to stay unique across
 * devices that have never seen each other.
 */
const existing = globalThis.crypto as Crypto | undefined;

if (typeof existing?.randomUUID !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: Object.assign(existing ?? {}, { randomUUID: (): Uuid => uuid.v4() as Uuid }),
  });
}
