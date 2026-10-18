import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { Body, Button, Card, Notice } from './ui';
import { Toggle } from './form';
import { BIRTH_REMINDER_DAYS } from '@nasl/shared';
import {
  disablePush,
  enablePush,
  pushSupport,
  readPushState,
  testPush,
  type PushState,
} from '../notifications/push';
import { spacing } from '../theme';

export function PushSettings() {
  const { t, i18n } = useTranslation('notifications');
  const { me } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [days, setDays] = useState<number[]>([0]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const support = pushSupport();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (support === 'supported' && me)
        void readPushState(me.id)
          .then((next) => {
            if (active) {
              setState(next);
              setDays(next.reminderDays);
            }
          })
          .catch(() => {
            if (active) setMessage(t('error'));
          });
      return () => {
        active = false;
      };
    }, [support, t, me]),
  );
  const run = async (action: 'enable' | 'disable' | 'test') => {
    if (!me || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (action === 'enable') {
        await enablePush(me.id, i18n.resolvedLanguage ?? 'ar', days);
        setState({ available: true, enabled: true, reminderDays: days });
      } else if (action === 'disable') {
        await disablePush();
        setState((old) => old && { ...old, enabled: false });
      } else {
        await testPush();
        setMessage(t('testSent'));
      }
    } catch (error) {
      setMessage(
        t(error instanceof Error && error.message === 'permission_denied' ? 'denied' : 'error'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <Body>{t('title')}</Body>
        <Body muted>{t('description')}</Body>
        {support !== 'supported' ? (
          <Body muted>{t(support === 'install' ? 'installFirst' : 'unsupported')}</Body>
        ) : (
          <>
            <Body muted>{t('leadLabel')}</Body>
            {BIRTH_REMINDER_DAYS.map((day) => (
              <Toggle
                key={day}
                label={t(`lead${day}` as 'lead0')}
                value={days.includes(day)}
                onChange={(selected) => {
                  if (!busy)
                    setDays((previous) =>
                      selected
                        ? [...previous, day].sort((a, b) => a - b)
                        : previous.filter((value) => value !== day),
                    );
                }}
              />
            ))}
            {!days.length ? <Body muted>{t('chooseTiming')}</Body> : null}
            <Body muted>{t(state?.enabled ? 'enabled' : 'disabled')}</Body>
            <Button
              label={t(state?.enabled ? 'save' : 'enable')}
              onPress={() => void run('enable')}
              busy={busy}
              disabled={!state?.available || !days.length}
            />
            {state?.enabled ? (
              <>
                <Button label={t('test')} onPress={() => void run('test')} disabled={busy} />
                <Button label={t('disable')} onPress={() => void run('disable')} disabled={busy} />
              </>
            ) : null}
            {state && !state.available ? <Body muted>{t('unavailable')}</Body> : null}
          </>
        )}
        {message ? <Notice>{message}</Notice> : null}
      </View>
    </Card>
  );
}
