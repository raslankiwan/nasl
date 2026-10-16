import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';

export interface InvitationMessage {
  id: string;
  email: string;
  url: string;
  locale: 'ar' | 'en';
}
export type InvitationMailer = (message: InvitationMessage) => Promise<void>;

export function invitationMailer(config: Config): InvitationMailer | undefined {
  if (!config.RESEND_API_KEY || !config.ADMIN_INVITE_FROM || !config.ADMIN_APP_URL)
    return undefined;
  return async ({ id, email, url, locale }) => {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${config.RESEND_API_KEY}`,
          'content-type': 'application/json',
          'Idempotency-Key': `admin-invite/${id}`,
        },
        body: JSON.stringify({
          from: `Nasl <${config.ADMIN_INVITE_FROM}>`,
          to: [email],
          subject: locale === 'ar' ? 'دعوة إلى إدارة نَسْل' : 'Invitation to Nasl administration',
          text:
            locale === 'ar'
              ? `تمت دعوتك للانضمام إلى إدارة نَسْل. افتح الرابط أدناه لقبول الدعوة. الرابط صالح لمدة 24 ساعة ولمرة واحدة فقط. إذا كان لديك حساب، استخدم كلمة مروره الحالية.\n\n${url}\n\nإذا لم تكن تتوقع هذه الدعوة، تجاهل هذه الرسالة.`
              : `You have been invited to administer Nasl. Open the link below to accept. This link expires in 24 hours and can be used once. If you already have an account, use its current password.\n\n${url}\n\nIf you did not expect this invitation, ignore this email.`,
        }),
      });
      if (!response.ok) throw new Error('Email rejected');
      const result = (await response.json()) as { id?: string };
      if (!result.id) throw new Error('Missing delivery receipt');
    } catch {
      // Provider responses may contain addresses or message bodies. Never log or return them.
      throw new AppError(
        'email_delivery_failed',
        'The invitation could not be sent. Try again later.',
      );
    }
  };
}
