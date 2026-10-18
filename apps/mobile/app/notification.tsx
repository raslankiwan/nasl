import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../src/auth/AuthProvider';
import { Body, Screen } from '../src/components/ui';

/** Select only a farm the signed-in user can access before following a push deep link. */
export default function NotificationLink() {
  const { farmId: targetFarm, animalId } = useLocalSearchParams<{
    farmId?: string;
    animalId?: string;
  }>();
  const { me, farmId, selectFarm, status } = useAuth();
  const router = useRouter();
  const { t } = useTranslation('common');
  useEffect(() => {
    if (status !== 'signedIn') return;
    if (
      !me?.farms.some((farm) => farm.farmId === targetFarm) ||
      !/^[a-f\d-]{36}$/i.test(animalId ?? '')
    ) {
      router.replace('/');
      return;
    }
    if (farmId !== targetFarm) {
      selectFarm(targetFarm!);
      return;
    }
    router.replace(`/animal/${animalId}`);
  }, [status, me, farmId, targetFarm, animalId, selectFarm, router]);
  return (
    <Screen>
      <Body>{t('loading')}</Body>
    </Screen>
  );
}
