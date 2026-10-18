import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1),
    MONGODB_DB_NAME: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,38}$/)
      .default('nasl'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(90),
    CORS_ORIGINS: z.string().default(''),
    VAPID_PUBLIC_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{87}$/)
      .optional(),
    VAPID_PRIVATE_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
    VAPID_SUBJECT: z.string().url().optional(),
    CRON_SECRET: z.string().min(32).optional(),
    ADMIN_APP_URL: z.string().url().optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().email().optional(),
    ADMIN_INVITE_FROM: z.string().email().optional(),
    MONGO_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(5),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((config, ctx) => {
    if (config.ADMIN_APP_URL) {
      const url = new URL(config.ADMIN_APP_URL);
      if (
        url.origin !== config.ADMIN_APP_URL ||
        (config.NODE_ENV === 'production' && url.protocol !== 'https:')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['ADMIN_APP_URL'],
          message: 'Use an exact admin origin, with HTTPS in production',
        });
      }
    }
    for (const origin of config.CORS_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean)) {
      try {
        if (new URL(origin).origin !== origin) throw new Error();
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'Use comma-separated URL origins without paths or trailing slashes',
        });
      }
    }
  });

export type Config = z.infer<typeof schema>;

/**
 * Parse and validate the environment once, at boot. A misconfigured server should refuse to
 * start rather than fail on the first request that happens to need the missing value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
