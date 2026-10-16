import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Body, Button } from './ui';
import { spacing } from '../theme';

type InstallWindow = Window & {
  naslInstall?: { installed: boolean; prompt?: () => Promise<void> };
};

export function InstallApp() {
  const { t } = useTranslation('common');
  const [installed, setInstalled] = useState(false);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const sync = () => setInstalled(Boolean((window as InstallWindow).naslInstall?.installed));
    sync();
    window.addEventListener('nasl-install-change', sync);
    return () => window.removeEventListener('nasl-install-change', sync);
  }, []);
  const install = async () => {
    const prompt = (window as InstallWindow).naslInstall?.prompt;
    if (prompt) await prompt().catch(() => setHint(true));
    else setHint((value) => !value);
  };
  if (installed) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <Button variant="secondary" label={t('installApp')} onPress={() => void install()} />
      {hint && <Body muted>{t('installHint')}</Body>}
    </View>
  );
}
