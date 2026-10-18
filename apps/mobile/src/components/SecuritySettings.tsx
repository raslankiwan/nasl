import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import {
  authenticateDevice,
  biometricSupport,
  biometricUser,
  setBiometricUser,
} from '../auth/nativeBiometrics';
import { Body, Button, Card, Notice } from './ui';

export function SecuritySettings() {
  const { t } = useTranslation('auth');
  const { me } = useAuth();
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    void biometricSupport()
      .then(setAvailable)
      .catch(() => setError(true));
    void biometricUser()
      .then((owner) => setEnabled(owner === me?.id))
      .catch(() => setError(true));
  }, [me?.id]);
  return (
    <Card>
      <Body>{t('security')}</Body>
      <Body muted>{t('session90')}</Body>
      <Body muted>{t(available ? 'biometricHint' : 'passkeyUnsupported')}</Body>
      <Body>{t(enabled ? 'biometricEnabled' : 'biometricDisabled')}</Body>
      {error ? <Notice tone="danger">{t('passkeyError')}</Notice> : null}
      {available || enabled ? (
        <Button
          label={t(enabled ? 'biometricDisable' : 'biometricEnable')}
          busy={busy}
          onPress={() =>
            void (async () => {
              if (busy || !me) return;
              setBusy(true);
              setError(false);
              try {
                if (await authenticateDevice(t('unlock'))) {
                  await setBiometricUser(enabled ? null : me.id);
                  setEnabled(!enabled);
                }
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            })()
          }
        />
      ) : null}
    </Card>
  );
}
