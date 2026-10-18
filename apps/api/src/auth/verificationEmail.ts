import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';

export interface VerificationMessage {
  id: string;
  email: string;
  code: string;
  locale: string;
}
export type VerificationMailer = (message: VerificationMessage) => Promise<void>;

export function verificationMailer(config: Config): VerificationMailer | undefined {
  const from = config.EMAIL_FROM ?? config.ADMIN_INVITE_FROM;
  if (!config.RESEND_API_KEY || !from) return undefined;
  return async ({ id, email, code, locale }) => {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${config.RESEND_API_KEY}`,
          'content-type': 'application/json',
          'Idempotency-Key': `verify-email/${id}`,
        },
        body: JSON.stringify({
          from: `Nasl <${from}>`,
          to: [email],
          subject: locale === 'ar' ? 'تأكيد بريدك الإلكتروني في نَسْل' : 'Verify your Nasl email',
          text:
            locale === 'ar'
              ? `رمز تأكيد بريدك الإلكتروني: ${code}\n\nأدخله في نَسْل خلال 15 دقيقة. يبقى حسابك بانتظار موافقة المسؤول بعد التأكيد. لا تشارك الرمز مع أي شخص. إذا لم تنشئ حساباً، تجاهل هذه الرسالة.`
              : `Your email verification code: ${code}\n\nEnter it in Nasl within 15 minutes. Your account will still need administrator approval. Do not share this code. If you did not register, ignore this email.`,
        }),
      });
      if (!response.ok || !((await response.json()) as { id?: string }).id) throw new Error();
    } catch {
      throw new AppError(
        'email_delivery_failed',
        'The verification email could not be sent. Try again later.',
      );
    }
  };
}
