import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '@nasl/shared';
import type { Config } from '../config.ts';
import { parse } from '../http/validate.ts';
import { mongoRateLimitStore } from './rateLimitStore.ts';
import { acceptInvitation, inspectInvitation } from '../services/adminInvitations.service.ts';

const tokenInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const acceptInput = tokenInput
  .extend({
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    name: z.string().trim().min(1).max(80).optional(),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{2,31}$/)
      .optional(),
  })
  .strict();

export function invitationAuthRoutes(config: Config) {
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      store: mongoRateLimitStore('admin-invitation-ip'),
      handler: (_req, res) => {
        res.status(429).json({
          error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' },
        });
      },
    }),
  );
  router.post('/inspect', async (req, res) => {
    const { token } = parse(tokenInput, req.body);
    res.json(await inspectInvitation(token));
  });
  router.post('/accept', async (req, res) => {
    res.json(
      await acceptInvitation(parse(acceptInput, req.body), config.NODE_ENV === 'production'),
    );
  });
  return router;
}
