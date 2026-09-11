import { useEffect, useState } from 'react';
import { TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { HEALTH_EVENT_TYPES, ROUTES } from '@nasl/shared';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { Choice, DateField, FieldGroup, NumberField } from '../../src/components/form';
import { Body, Notice } from '../../src/components/ui';
import { colors, MIN_TOUCH, radius, spacing, type } from '../../src/theme';

interface Product {
  id: string;
  nameAr: string;
  nameEn: string;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
}

export default function RecordTreatment() {
  const { animalId } = useLocalSearchParams<{ animalId: string }>();
  const { t, i18n } = useTranslation(['health', 'common']);
  const { farmId, me } = useAuth();
  const arabic = (i18n.resolvedLanguage ?? 'ar') === 'ar';

  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));
  const [eventType, setEventType] = useState<(typeof HEALTH_EVENT_TYPES)[number]>('treatment');
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [dose, setDose] = useState<number | null>(null);
  const [route, setRoute] = useState<(typeof ROUTES)[number]>('subcutaneous');
  const [administeredBy, setAdministeredBy] = useState(me?.name ?? '');

  useEffect(() => {
    if (!farmId) return;
    api
      .get<{ products: Product[] }>(`/v1/farms/${farmId}/health/products`)
      .then((res) => setProducts(res.products))
      .catch(() => setProducts([]));
  }, [farmId]);

  const selected = products.find((p) => p.id === productId);

  return (
    <CaptureScreen
      title={t('health:recordTreatment')}
      canSave={Boolean(farmId && animalId) && administeredBy.trim().length > 0}
      onSave={() =>
        api.post(`/v1/farms/${farmId}/health/treatments`, {
          animalIds: [animalId],
          date: date.toISOString().slice(0, 10),
          type: eventType,
          ...(productId ? { productId } : {}),
          ...(dose !== null ? { doseValue: dose, doseUnit: 'ml' } : {}),
          route,
          administeredBy: administeredBy.trim(),
        })
      }
    >
      <DateField label={t('common:date')} value={date} onChange={setDate} />

      <FieldGroup label={t('health:title')}>
        <Choice
          columns={3}
          options={HEALTH_EVENT_TYPES}
          value={eventType}
          onChange={setEventType}
          labelFor={(e) => t(`health:eventTypes.${e}` as 'health:eventTypes.treatment')}
        />
      </FieldGroup>

      <FieldGroup label={t('health:product')}>
        {products.length === 0 ? (
          <Body muted>{t('health:noProducts')}</Body>
        ) : (
          <Choice
            columns={2}
            options={['', ...products.map((p) => p.id)]}
            value={productId}
            onChange={setProductId}
            labelFor={(id) => {
              if (id === '') return t('common:none');
              const product = products.find((p) => p.id === id);
              return (arabic ? product?.nameAr : product?.nameEn) ?? id;
            }}
          />
        )}
      </FieldGroup>

      {/*
        Show the consequence before the treatment is saved, not after. For a dairy flock the milk
        hold is the one that bites — it starts at the next milking.
      */}
      {selected && (selected.withdrawalMilkDays > 0 || selected.withdrawalMeatDays > 0) ? (
        <Notice tone="danger">
          {[
            selected.withdrawalMilkDays > 0
              ? `${t('health:doNotMilk')} · ${t('common:days', { count: selected.withdrawalMilkDays })}`
              : null,
            selected.withdrawalMeatDays > 0
              ? `${t('health:doNotSell')} · ${t('common:days', { count: selected.withdrawalMeatDays })}`
              : null,
          ]
            .filter(Boolean)
            .join('   ')}
        </Notice>
      ) : null}

      <NumberField
        label={t('health:dose')}
        value={dose}
        onChange={setDose}
        min={0.5}
        max={100}
        step={0.5}
        initial={5}
        suffix="ml"
        optional
      />

      <FieldGroup label={t('health:route')}>
        <Choice
          columns={3}
          options={ROUTES}
          value={route}
          onChange={setRoute}
          labelFor={(r) => t(`health:routes.${r}` as 'health:routes.subcutaneous')}
        />
      </FieldGroup>

      <FieldGroup label={t('health:administeredBy')}>
        <TextInput
          value={administeredBy}
          onChangeText={setAdministeredBy}
          placeholderTextColor={colors.muted}
          style={{
            minHeight: MIN_TOUCH,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.md,
            fontSize: type.body,
            color: colors.ink,
            textAlign: 'left',
          }}
        />
      </FieldGroup>
    </CaptureScreen>
  );
}
