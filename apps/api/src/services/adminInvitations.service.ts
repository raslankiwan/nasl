import { createHash, randomBytes } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../errors.ts';
import { User } from '../models/user.model.ts';
import { AdminInvitation } from '../models/adminInvitation.model.ts';
import { recordAudit } from '../models/auditLog.model.ts';
import { registrationSchema } from '../auth/credentials.ts';
import { hashPassword, verifyPassword } from '../auth/passwords.ts';
import type { InvitationMailer } from '../auth/invitationEmail.ts';
import { parse } from '../http/validate.ts';

const TTL_MS = 24 * 60 * 60_000;
export const invitationHash = (token: string) => createHash('sha256').update(token).digest('hex');
const invalid = () =>
  new AppError('invitation_invalid', 'This invitation is invalid, expired or already used.');
const link = (origin: string, token: string) => `${origin}/accept-invite#token=${token}`;

async function validInvitation(token: string, session?: ClientSession) {
  const invite = await AdminInvitation.findOne({
    tokenHash: invitationHash(token),
    state: 'sent',
    expiresAt: { $gt: new Date() },
  })
    .session(session ?? null)
    .lean();
  if (!invite) throw invalid();
  if (
    invite.kind === 'admin' &&
    !(await User.exists({
      _id: invite.invitedBy,
      status: 'approved',
      isPlatformAdmin: true,
    }).session(session ?? null))
  )
    throw invalid();
  return invite;
}

export async function inspectInvitation(token: string) {
  const invite = await validInvitation(token);
  const user = await User.findOne({ email: invite.email }).select('+passwordHash').lean();
  if (
    invite.kind === 'bootstrap' &&
    (!user || user._id !== invite.userId || user.adminProvisionedBy !== 'seed' || user.passwordHash)
  )
    throw invalid();
  if (invite.kind === 'admin' && user?.isPlatformAdmin) throw invalid();
  return {
    email: invite.email,
    name: user?.name ?? '',
    username: user?.username ?? '',
    existingAccount: invite.kind === 'admin' && Boolean(user),
    seeded: invite.kind === 'bootstrap',
  };
}

export async function sendInvitation(
  input: { email: string; actorId: string; locale: 'ar' | 'en' },
  origin: string | undefined,
  send: InvitationMailer | undefined,
) {
  if (!origin || !send)
    throw new AppError('email_not_configured', 'Configure the invitation email sender first.');
  if (await User.exists({ email: input.email, isPlatformAdmin: true }))
    throw AppError.conflict('This account is already an administrator.');
  if (
    await AdminInvitation.exists({
      email: input.email,
      state: { $in: ['pending', 'sent'] },
      expiresAt: { $gt: new Date() },
    })
  )
    throw AppError.conflict('An invitation is already active. Revoke it before sending another.');
  const token = randomBytes(32).toString('hex');
  const invite = await AdminInvitation.create({
    email: input.email,
    tokenHash: invitationHash(token),
    invitedBy: input.actorId,
    locale: input.locale,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  try {
    await recordAudit({
      actorId: input.actorId,
      action: 'admin.invitation.create',
      targetType: 'adminInvitation',
      targetId: invite._id,
      after: { email: invite.email, expiresAt: invite.expiresAt },
    });
  } catch (error) {
    await AdminInvitation.deleteOne({ _id: invite._id });
    throw error;
  }
  try {
    await send({
      id: invite._id,
      email: invite.email,
      url: link(origin, token),
      locale: input.locale,
    });
    await AdminInvitation.updateOne(
      { _id: invite._id, state: 'pending' },
      { $set: { state: 'sent' } },
    );
  } catch (error) {
    await AdminInvitation.updateOne(
      { _id: invite._id, state: 'pending' },
      { $set: { state: 'failed' } },
    );
    if (error instanceof AppError) throw error;
    throw new AppError(
      'email_delivery_failed',
      'The invitation could not be sent. Try again later.',
    );
  }
  return { id: invite._id, email: invite.email, expiresAt: invite.expiresAt, state: 'sent' };
}

export async function acceptInvitation(
  input: { token: string; password: string; name?: string; username?: string },
  transactional: boolean,
) {
  const apply = async (session?: ClientSession) => {
    const invite = await validInvitation(input.token, session);
    const user = await User.findOne({ email: invite.email })
      .select('+passwordHash')
      .session(session ?? null)
      .lean();
    const bootstrap = invite.kind === 'bootstrap';
    if (
      bootstrap &&
      (!user ||
        user._id !== invite.userId ||
        user.adminProvisionedBy !== 'seed' ||
        user.passwordHash)
    )
      throw invalid();
    if (!bootstrap && user?.isPlatformAdmin) throw invalid();
    if (!bootstrap && user && !(await verifyPassword(input.password, user.passwordHash))) {
      // An invitation must never elevate a squatted account using a password its owner did not choose.
      throw new AppError(
        'invitation_existing_password',
        'Use the existing account password to accept this invitation.',
      );
    }
    const profile =
      !user || bootstrap
        ? parse(registrationSchema, {
            email: invite.email,
            name: user?.name ?? input.name,
            username: user?.username ?? input.username,
            password: input.password,
            locale: invite.locale,
          })
        : null;
    const passwordHash = profile ? await hashPassword(profile.password) : undefined;
    const acceptedAt = new Date();
    const claimed = await AdminInvitation.updateOne(
      { _id: invite._id, state: 'sent', expiresAt: { $gt: acceptedAt } },
      { $set: { state: 'accepted', acceptedAt } },
      { session },
    );
    if (!claimed.modifiedCount) throw invalid();
    let createdId: string | undefined;
    let changedExisting = false;
    try {
      let userId: string;
      if (user) {
        const changed = await User.updateOne(
          {
            _id: user._id,
            isPlatformAdmin: user.isPlatformAdmin,
            status: user.status,
            passwordHash: user.passwordHash ?? { $exists: false },
          },
          {
            $set: {
              isPlatformAdmin: true,
              status: 'approved',
              emailVerifiedAt: acceptedAt,
              adminProvisionedBy: bootstrap ? 'seed' : 'invitation',
              reviewedAt: acceptedAt,
              reviewedBy: invite.invitedBy,
              ...(passwordHash ? { passwordHash } : {}),
            },
          },
          { session },
        );
        if (!changed.modifiedCount)
          throw AppError.conflict('The account changed. Request a new invitation.');
        changedExisting = true;
        userId = user._id;
      } else {
        const { password: _password, ...fields } = profile!;
        const [created] = await User.create(
          [
            {
              ...fields,
              passwordHash,
              isPlatformAdmin: true,
              status: 'approved',
              emailVerifiedAt: acceptedAt,
              adminProvisionedBy: 'invitation',
              reviewedAt: acceptedAt,
              reviewedBy: invite.invitedBy,
            },
          ],
          { session },
        );
        createdId = created!._id;
        userId = createdId;
      }
      await recordAudit(
        {
          actorId: userId,
          action: bootstrap ? 'admin.bootstrap.activate' : 'admin.invitation.accept',
          targetType: 'user',
          targetId: userId,
          before: { status: user?.status ?? null, isPlatformAdmin: user?.isPlatformAdmin ?? false },
          after: {
            status: 'approved',
            isPlatformAdmin: true,
            invitationId: invite._id,
            invitedBy: invite.invitedBy,
          },
        },
        session,
      );
      return { id: userId, status: 'approved' as const };
    } catch (error) {
      if (!session) {
        if (createdId) await User.deleteOne({ _id: createdId });
        if (changedExisting && user)
          await User.updateOne(
            { _id: user._id, reviewedAt: acceptedAt },
            {
              $set: {
                isPlatformAdmin: user.isPlatformAdmin,
                status: user.status,
                emailVerifiedAt: user.emailVerifiedAt ?? null,
                reviewedAt: user.reviewedAt ?? null,
                reviewedBy: user.reviewedBy ?? null,
                adminProvisionedBy: user.adminProvisionedBy ?? null,
              },
              ...(bootstrap ? { $unset: { passwordHash: '' } } : {}),
            },
          );
        await AdminInvitation.updateOne(
          { _id: invite._id, state: 'accepted', acceptedAt },
          { $set: { state: 'sent' }, $unset: { acceptedAt: '' } },
        );
      }
      if ((error as { code?: number }).code === 11000)
        throw new AppError('registration_conflict', 'That username is already in use.');
      throw error;
    }
  };
  return transactional ? mongoose.connection.transaction(apply) : apply();
}

export async function revokeInvitation(id: string, actorId: string, transactional: boolean) {
  const apply = async (session?: ClientSession) => {
    const previous = await AdminInvitation.findOneAndUpdate(
      { _id: id, kind: 'admin', state: { $in: ['pending', 'sent'] } },
      { $set: { state: 'revoked' } },
      { session },
    ).lean();
    if (!previous) throw AppError.conflict('This invitation is no longer active.');
    try {
      await recordAudit(
        {
          actorId,
          action: 'admin.invitation.revoke',
          targetType: 'adminInvitation',
          targetId: id,
          before: { state: previous.state },
          after: { state: 'revoked' },
        },
        session,
      );
    } catch (error) {
      if (!session)
        await AdminInvitation.updateOne(
          { _id: id, state: 'revoked' },
          { $set: { state: previous.state } },
        );
      throw error;
    }
    return { id, state: 'revoked' };
  };
  return transactional ? mongoose.connection.transaction(apply) : apply();
}

export async function seedFirstAdmin(
  input: { email: string; username: string; name: string; locale: 'ar' | 'en' },
  origin: string,
  transactional: boolean,
  reissue = false,
) {
  const apply = async (session?: ClientSession) => {
    let user = await User.findOne({ email: input.email })
      .select('+passwordHash')
      .session(session ?? null)
      .lean();
    if (user && (!user.isPlatformAdmin || user.adminProvisionedBy !== 'seed'))
      throw AppError.conflict(
        'An account already uses this email. The seed will not overwrite it.',
      );
    if (user?.passwordHash || (user && !reissue)) return { id: user._id, created: false };
    if (!user && (await User.exists({ isPlatformAdmin: true }).session(session ?? null)))
      throw AppError.conflict('The first administrator already exists. Use an email invitation.');
    let createdId: string | undefined;
    let invitationId: string | undefined;
    try {
      if (!user) {
        const [created] = await User.create(
          [{ ...input, status: 'approved', isPlatformAdmin: true, adminProvisionedBy: 'seed' }],
          { session },
        );
        createdId = created!._id;
        user = created!.toObject();
      }
      const token = randomBytes(32).toString('hex');
      const [invite] = await AdminInvitation.create(
        [
          {
            email: user!.email,
            userId: user!._id,
            tokenHash: invitationHash(token),
            invitedBy: 'bootstrap-cli',
            kind: 'bootstrap',
            state: 'sent',
            locale: input.locale,
            expiresAt: new Date(Date.now() + TTL_MS),
          },
        ],
        { session },
      );
      invitationId = invite!._id;
      await recordAudit(
        {
          actorId: 'bootstrap-cli',
          action: createdId ? 'admin.bootstrap.seed' : 'admin.bootstrap.reissue',
          targetType: 'user',
          targetId: user!._id,
          after: {
            email: user!.email,
            username: user!.username,
            status: 'approved',
            isPlatformAdmin: true,
          },
        },
        session,
      );
      await AdminInvitation.updateMany(
        { userId: user!._id, kind: 'bootstrap', _id: { $ne: invitationId }, state: 'sent' },
        { $set: { state: 'revoked' } },
        { session },
      );
      return {
        id: user!._id,
        created: Boolean(createdId),
        setupUrl: link(origin, token),
        expiresAt: invite!.expiresAt,
      };
    } catch (error) {
      if (!session) {
        if (invitationId) await AdminInvitation.deleteOne({ _id: invitationId });
        if (createdId) await User.deleteOne({ _id: createdId });
      }
      throw error;
    }
  };
  return transactional ? mongoose.connection.transaction(apply) : apply();
}
