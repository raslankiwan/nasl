import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP's scrypt option with 32 MiB memory and parallelization factor 3.
// Node's built-in implementation avoids a native dependency in the serverless bundle.
const N = 32768;
const R = 8;
const P = 3;
const KEY_LENGTH = 64;

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored?: string): Promise<boolean> {
  const parts = stored?.split('$');
  const valid =
    parts?.length === 6 &&
    parts[0] === 'scrypt' &&
    parts[1] === String(N) &&
    parts[2] === String(R) &&
    parts[3] === String(P) &&
    /^[a-f0-9]{32}$/.test(parts[4]!) &&
    /^[a-f0-9]{128}$/.test(parts[5]!);
  // Unknown accounts and legacy accounts still perform the expensive work.
  const actual = await derive(password, valid ? parts![4]! : '0'.repeat(32));
  const expected = Buffer.from(valid ? parts![5]! : '0'.repeat(128), 'hex');
  return timingSafeEqual(actual, expected) && Boolean(valid);
}
