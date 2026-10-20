import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Body, Button } from '../components/ui';
import { useTheme, spacing } from '../theme';
import { revokeSession } from '../api/client';
import { useAuth } from './AuthProvider';
import { isImpersonating, supportSnapshot, clearSupportFragment } from './impersonation';

export function SupportFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const { colors } = useTheme();
  const { me, status } = useAuth();
  useEffect(() => {
    if (status === 'signedIn') clearSupportFragment();
  }, [status]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!isImpersonating()) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!isImpersonating()) return children;
  const state = supportSnapshot();
  const ended = state.failed || state.expired || status === 'signedOut';
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={{ padding: spacing.sm, gap: spacing.xs, backgroundColor: colors.accentSoft }}>
        <Body>{ended ? t('supportEnded') : t('actingAs', { name: me?.name ?? t('loading') })}</Body>
        <Body muted>{t('supportHint')}</Body>
        <Button label={t('exitSupport')} variant="secondary" onPress={() => void revokeSession()} />
      </View>
      {!ended ? children : null}
    </View>
  );
}
