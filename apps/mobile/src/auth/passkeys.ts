export const passkeysAvailable = async () => false;
export async function passkeySignIn(): Promise<{ accessToken: string; refreshToken: string }> {
  throw new Error('Use native biometric unlock');
}
