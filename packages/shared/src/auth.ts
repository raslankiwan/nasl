export const ACCOUNT_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface RegistrationInput {
  name: string;
  email: string;
  username: string;
  password: string;
  locale?: 'ar' | 'en';
}
