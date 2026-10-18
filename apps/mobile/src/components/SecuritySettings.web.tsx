import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { addPasskey, passkeysAvailable } from '../auth/passkeys.web';
import { Body, Button, Card, Field, Notice } from './ui';

export function SecuritySettings() {
  const { t } = useTranslation(['auth', 'common']);
  const [available, setAvailable] = useState(false);
  const [keys, setKeys] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState(t('auth:thisDevice'));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => {
    setKeys((await api.get<{ passkeys: typeof keys }>('/v1/auth/passkeys')).passkeys);
  };
  useEffect(() => {
    void passkeysAvailable().then(setAvailable);
    void load().catch(() => setMessage(t('common:errorRetry')));
  }, [t]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await work();
      await load();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? t(`auth:errors.${error.code}`, { defaultValue: t('auth:passkeyError') })
          : t('auth:passkeyError'),
      );
    } finally {
      setPassword('');
      setBusy(false);
    }
  };
  return (
    <Card>
      <Body>{t('auth:security')}</Body>
      <Body muted>{t('auth:session90')}</Body>
      <Body muted>{t(available ? 'auth:passkeyHint' : 'auth:passkeyUnsupported')}</Body>
      {message ? <Notice>{message}</Notice> : null}
      {available ? (
        <>
          <Field
            label={t('auth:passkeyName')}
            value={name}
            onChangeText={setName}
            maxLength={60}
            editable={!busy}
          />
          <Field
            label={t('auth:password')}
            hint={t('auth:passkeyPasswordHint')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            maxLength={128}
            editable={!busy}
          />
          <Button
            label={t('auth:passkeyAdd')}
            busy={busy}
            disabled={!password || !name.trim()}
            onPress={() =>
              void run(async () => {
                await addPasskey(password, name.trim());
                setMessage(t('auth:passkeySaved'));
              })
            }
          />
        </>
      ) : null}
      {!keys.length ? (
        <Body muted>{t('auth:passkeyNone')}</Body>
      ) : (
        keys.map((key) => (
          <Button
            key={key.id}
            variant="text"
            label={t('auth:passkeyRemove', { name: key.name })}
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await api.post('/v1/auth/passkeys/remove', { id: key.id });
              })
            }
          />
        ))
      )}
    </Card>
  );
}
