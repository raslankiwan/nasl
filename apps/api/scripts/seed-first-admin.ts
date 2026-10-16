import { parseArgs } from 'node:util';
import { access, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import '../src/models/index.ts';
import { loadConfig } from '../src/config.ts';
import { connectDatabase, disconnectDatabase } from '../src/db.ts';
import { createLogger } from '../src/logger.ts';
import { seedFirstAdmin } from '../src/services/adminInvitations.service.ts';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    username: { type: 'string' },
    name: { type: 'string' },
    output: { type: 'string' },
    reissue: { type: 'boolean', default: false },
  },
});
const input = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{2,31}$/),
    name: z.string().trim().min(1).max(80),
  })
  .parse(values);
if (!values.output)
  throw new Error('Pass --output with a private local file for the one-use setup link.');
await access(values.output).then(
  () => {
    throw new Error(
      'The output file already exists. Choose a new private file; the seed has not changed anything.',
    );
  },
  (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  },
);
const config = loadConfig();
if (!config.ADMIN_APP_URL) throw new Error('ADMIN_APP_URL must be configured.');
try {
  await connectDatabase(config.MONGODB_URI, createLogger('warn', false), {
    dbName: config.MONGODB_DB_NAME,
    maxPoolSize: 2,
  });
  const result = await seedFirstAdmin(
    { ...input, locale: 'ar' },
    config.ADMIN_APP_URL,
    config.NODE_ENV === 'production',
    values.reissue,
  );
  if (result.setupUrl) {
    // Refuse to overwrite another setup link; never print bearer credentials to logs.
    await writeFile(values.output, JSON.stringify({ ...input, ...result }, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
    console.log(`First administrator seeded. Private setup link saved to ${values.output}`);
  } else
    console.log(
      `Administrator already seeded (${result.id}); account and password unchanged. Use --reissue only if the unused setup link was lost or expired.`,
    );
} finally {
  await disconnectDatabase();
}
