import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { AdminInvitation } from '../models/adminInvitation.model.ts';
import { parse, pathParam, userIdOf } from '../http/validate.ts';
import { sendInvitation, revokeInvitation } from '../services/adminInvitations.service.ts';
import { invitationMailer, type InvitationMailer } from '../auth/invitationEmail.ts';
import { mongoRateLimitStore } from '../auth/rateLimitStore.ts';

const inviteInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    locale: z.enum(['ar', 'en']).default('ar'),
  })
  .strict();

/** Mounted only after requireAuth + requirePlatformAdmin. */
export function adminInvitationsRoutes(config: Config, mailer?: InvitationMailer) {
  const router = Router();
  const send = mailer ?? invitationMailer(config);
  router.get('/', async (_req, res) => {
    const invitations = await AdminInvitation.find({ kind: 'admin' })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({
      emailConfigured: Boolean(send && config.ADMIN_APP_URL),
      invitations: invitations.map((i) => ({
        id: i._id,
        email: i.email,
        state:
          i.expiresAt <= new Date() && ['pending', 'sent'].includes(i.state) ? 'expired' : i.state,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
    });
  });
  router.post(
    '/',
    rateLimit({
      windowMs: 60 * 60_000,
      limit: 10,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => userIdOf(req),
      store: mongoRateLimitStore('admin-invitation-send'),
      handler: (_req, res) => {
        res.status(429).json({
          error: { code: 'rate_limited', message: 'Too many invitations. Try again later.' },
        });
      },
    }),
    async (req, res) => {
      res
        .status(201)
        .json(
          await sendInvitation(
            { ...parse(inviteInput, req.body), actorId: userIdOf(req) },
            config.ADMIN_APP_URL,
            send,
          ),
        );
    },
  );
  router.post('/:invitationId/revoke', async (req, res) => {
    res.json(
      await revokeInvitation(
        pathParam(req, 'invitationId'),
        userIdOf(req),
        config.NODE_ENV === 'production',
      ),
    );
  });
  return router;
}
