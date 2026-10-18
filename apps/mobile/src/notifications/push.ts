/** Native push needs the later EAS build/device setup. The deployed app uses Web Push. */
export type PushSupport = 'supported' | 'install' | 'unsupported';
export interface PushState {
  available: boolean;
  enabled: boolean;
  reminderDays: number[];
}
export const pushSupport = (): PushSupport => 'unsupported';
export const readPushState = async (_userId: string): Promise<PushState> => ({
  available: false,
  enabled: false,
  reminderDays: [0],
});
export const enablePush = async (
  _userId: string,
  _locale: string,
  _reminderDays: number[],
): Promise<void> => {};
export const disablePush = async (): Promise<void> => {};
export const testPush = async (): Promise<void> => {};
export const forgetPushOwner = async (): Promise<void> => {};

export const reconcilePushOwner = async (_userId: string): Promise<void> => {};
