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
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    OTP_TTL_MINUTES: z.coerce.number().int().positive().default(5),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    SMS_PROVIDER: z.enum(['disabled', 'log', 'twilio']).default('disabled'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),
    CORS_ORIGINS: z.string().default(''),
    MONGO_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(5),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'production' && config.SMS_PROVIDER === 'log') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'Development codes cannot be exposed in production',
      });
    }
    if (config.SMS_PROVIDER === 'twilio') {
      for (const key of [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_FROM_NUMBER',
      ] as const) {
        if (!config[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Required for Twilio SMS delivery',
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
