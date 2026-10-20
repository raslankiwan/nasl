import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  adultEligibleOn,
  animalLabel,
  classificationError,
  profileFor,
  type Species,
} from '@nasl/shared';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAnimal } from '../../src/sync/useFlock';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { DateField } from '../../src/components/form';
import { Body, Notice } from '../../src/components/ui';

export default function Promote() {
  const { animalId } = useLocalSearchParams<{ animalId: string }>();
  const { farmId } = useAuth();
  const { animal } = useAnimal(animalId);
  const { t } = useTranslation(['animals', 'common']);
  const [birth, setBirth] = useState<Date | null>(null);
  const dateOfBirth = birth ?? (animal?.dateOfBirth ? new Date(animal.dateOfBirth) : null);
  const target = animal?.sex === 'male' ? 'male' : 'mother';
  const invalid = animal
    ? classificationError({ ...animal, dateOfBirth }, target)
    : 'birth_date_required';
  const eligible =
    animal && dateOfBirth ? adultEligibleOn(animal.species as Species, dateOfBirth) : null;
  return (
    <CaptureScreen
      title={t(target === 'mother' ? 'animals:promoteMother' : 'animals:promoteMale')}
      subtitle={animal ? animalLabel(animal) : undefined}
      path={`/v1/farms/${farmId}/animals/${animalId}/promote`}
      canSave={Boolean(
        farmId && animal?.status === 'active' && animal.classification === 'child' && !invalid,
      )}
      buildBody={(id) => ({
        id,
        classification: target,
        dateOfBirth: dateOfBirth?.toISOString().slice(0, 10),
      })}
    >
      <Body>
        {t('animals:promotionHint', {
          months: profileFor((animal?.species ?? 'sheep') as Species).pubertyMonths[0],
        })}
      </Body>
      {!dateOfBirth ? <Notice>{t('animals:birth_date_required')}</Notice> : null}
      <DateField
        label={t('animals:dateOfBirth')}
        value={dateOfBirth ?? new Date()}
        onChange={setBirth}
      />
      {invalid ? <Notice tone="danger">{t(`animals:${invalid}`)}</Notice> : null}
      {eligible ? <Body muted>{t('animals:eligibleOn', { date: eligible })}</Body> : null}
    </CaptureScreen>
  );
}
