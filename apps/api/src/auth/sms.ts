import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';

export async function sendOtpSms(config: Config, phone: string, code: string): Promise<void> {
  if (config.SMS_PROVIDER !== 'twilio') {
    throw new AppError('sign_in_unavailable', 'Phone sign-in is not available yet.');
  }
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.TWILIO_ACCOUNT_SID!)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        // A short message keeps each login to a single SMS segment.
        body: new URLSearchParams({
          To: phone,
          From: config.TWILIO_FROM_NUMBER!,
          Body: `Nasl: ${code}`,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error('SMS provider rejected delivery');
    await response.body?.cancel();
  } catch {
    // Provider errors can contain credentials, phone numbers and message contents.
    throw new AppError(
      'sign_in_unavailable',
      'Unable to send a verification code. Please try again later.',
    );
  }
}
