import { useAnimal } from '../../src/sync/useFlock';
import { useState } from 'react';
import { TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/auth/AuthProvider';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { DateField, FieldGroup } from '../../src/components/form';
import { MIN_TOUCH, radius, spacing, type, useTheme } from '../../src/theme';

export default function RecordAbortion() {
  const { colors } = useTheme();
  const { damId } = useLocalSearchParams<{ damId: string }>();
  const { t } = useTranslation(['breeding', 'common']);
  const { farmId } = useAuth();
  const { animal } = useAnimal(damId);

  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));
  const [cause, setCause] = useState('');

  return (
    <CaptureScreen
      title={t('breeding:abortion')}
      canSave={Boolean(farmId && animal?.classification === 'mother' && animal.status === 'active')}
      path={`/v1/farms/${farmId}/breeding/abortions`}
      buildBody={(id) => ({
        id,
        damId,
        date: date.toISOString().slice(0, 10),
        ...(cause.trim() ? { suspectedCause: cause.trim() } : {}),
      })}
    >
      <DateField label={t('common:date')} value={date} onChange={setDate} />
      <FieldGroup label={t('breeding:suspectedCause')}>
        <TextInput
          value={cause}
          onChangeText={setCause}
          multiline
          placeholderTextColor={colors.muted}
          style={{
            minHeight: MIN_TOUCH * 1.5,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            padding: spacing.md,
            fontSize: type.body,
            color: colors.ink,
            textAlign: 'left',
          }}
        />
      </FieldGroup>
    </CaptureScreen>
  );
}
