import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api, deviceId } from '../api/client';
export const passkeysAvailable = async () =>
  browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable().catch(() => false));
export async function passkeySignIn() {
  const device = await deviceId();
  const { challengeId, options } = await api.post<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>('/v1/auth/passkeys/login/options', { deviceId: device });
  const response = await startAuthentication({ optionsJSON: options });
  return api.post<{ accessToken: string; refreshToken: string }>('/v1/auth/passkeys/login/verify', {
    challengeId,
    response,
    deviceId: device,
  });
}
export async function addPasskey(password: string, name: string) {
  const device = await deviceId();
  const { challengeId, options } = await api.post<{
    challengeId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
  }>('/v1/auth/passkeys/register/options', { password, name, deviceId: device });
  const response = await startRegistration({ optionsJSON: options });
  await api.post('/v1/auth/passkeys/register/verify', { challengeId, response, deviceId: device });
}
