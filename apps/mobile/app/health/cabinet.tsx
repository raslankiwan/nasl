import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDate, type Locale } from '@nasl/i18n';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Button, Notice, Pill, Screen, Title } from '../../src/components/ui';
import { Choice, DateField, FieldGroup, NumberField } from '../../src/components/form';
import { colors, MIN_TOUCH, radius, spacing, type } from '../../src/theme';

interface Item {
  id: string;
  productId: string;
  productName: string;
  batchNo: string;
  expiry: string;
  daysToExpiry: number;
  qtyRemaining: number;
  unit: string;
  expired: boolean;
  expiringSoon: boolean;
  lowStock: boolean;
}
interface Product {
  id: string;
  nameAr: string;
  nameEn: string;
}

/**
 * What is on the shelf (FR-HLT-05).
 *
 * Ordered by what expires first, because that is both the bottle to use next and the one about to
 * be wasted. Expired stock is shown rather than hidden — knowing it is there is how it gets thrown
 * away instead of injected.
 */
export default function Cabinet() {
  const { t, i18n } = useTranslation(['health', 'common']);
  const { farmId } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const arabic = locale === 'ar';

  const [items, setItems] = useState<Item[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [productId, setProductId] = useState('');
  const [batchNo, setBatchNo] = useState('');
  // Opens a year out, which is where most veterinary expiries land.
  const [expiry, setExpiry] = useState(
    () => new Date(new Date(new Date().toISOString().slice(0, 10)).getTime() + 365 * 86_400_000),
  );
  const [quantity, setQuantity] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!farmId) return setLoading(false);
    try {
      const [shelf, library] = await Promise.all([
        api.get<{ items: Item[] }>(`/v1/farms/${farmId}/inventory`),
        api.get<{ products: Product[] }>(`/v1/farms/${farmId}/health/products`),
      ]);
      setItems(shelf.items);
      setProducts(library.products);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    } finally {
      setLoading(false);
    }
  }, [farmId, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const receive = async () => {
    setError(null);
    try {
      await api.post(`/v1/farms/${farmId}/inventory`, {
        productId,
        batchNo: batchNo.trim(),
        expiry: expiry.toISOString().slice(0, 10),
        quantity,
        unit: 'ml',
      });
      setAdding(false);
      setBatchNo('');
      setQuantity(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    }
  };

  const status = (item: Item) =>
    item.expired
      ? { label: t('health:expired'), tone: 'accent' as const }
      : item.expiringSoon
        ? { label: t('health:expiringSoon'), tone: 'accent' as const }
        : item.lowStock
          ? { label: t('health:lowStock'), tone: 'neutral' as const }
          : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
      >
        <Screen>
          <Button label={t('common:back')} variant="secondary" onPress={() => router.back()} />
          <View style={styles.gap} />

          <View style={styles.head}>
            <Title>{t('health:cabinet')}</Title>
            <Button
              label={adding ? t('common:cancel') : t('health:addStock')}
              variant="secondary"
              onPress={() => setAdding((v) => !v)}
            />
          </View>

          {error ? <Notice tone="danger">{error}</Notice> : null}

          {adding ? (
            <View style={styles.form}>
              <FieldGroup label={t('health:product')}>
                {products.length === 0 ? (
                  <Body muted>{t('health:noProducts')}</Body>
                ) : (
                  <Choice
                    columns={2}
                    options={products.map((p) => p.id)}
                    value={productId}
                    onChange={setProductId}
                    labelFor={(id) => {
                      const p = products.find((x) => x.id === id);
                      return (arabic ? p?.nameAr : p?.nameEn) ?? id;
                    }}
                  />
                )}
              </FieldGroup>

              <FieldGroup label={t('health:batch')}>
                <TextInput
                  value={batchNo}
                  onChangeText={setBatchNo}
                  autoCapitalize="characters"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </FieldGroup>

              {/* An expiry is always ahead of today, and stepping there by the day is hopeless. */}
              <DateField
                label={t('health:expiry')}
                value={expiry}
                onChange={setExpiry}
                allowFuture
              />

              <NumberField
                label={t('health:quantity')}
                value={quantity}
                onChange={setQuantity}
                min={1}
                max={10000}
                step={50}
                initial={250}
                suffix="ml"
                optional
              />

              <Button
                label={t('common:save')}
                onPress={() => void receive()}
                disabled={!productId || batchNo.trim().length === 0 || quantity === null}
              />
              <View style={styles.gap} />
            </View>
          ) : null}

          {items.length === 0 && !loading ? <Body muted>{t('health:emptyCabinet')}</Body> : null}

          {items.map((item) => {
            const flag = status(item);
            return (
              <View key={item.id} style={[styles.row, item.expired && styles.rowExpired]}>
                <View style={styles.rowMain}>
                  <Text style={styles.product} numberOfLines={2}>
                    {item.productName}
                  </Text>
                  {/*
                    Separate Text nodes, not one string. Arabic date formatting embeds
                    right-to-left marks so the date reads correctly inside Arabic prose; put it in
                    the same run as a Latin batch code and bidi reorders the date's own digits.
                    Two nodes are two runs, and each resolves on its own.
                  */}
                  <Text style={styles.meta}>
                    {t('health:batch')} <Text style={styles.code}>{item.batchNo}</Text>
                  </Text>
                  <Text style={styles.meta}>
                    {t('health:expiry')} {formatDate(new Date(item.expiry), locale)}
                  </Text>
                </View>
                <View style={styles.rowEnd}>
                  <Text style={styles.qty}>
                    {item.qtyRemaining} {item.unit}
                  </Text>
                  {flag ? <Pill tone={flag.tone}>{flag.label}</Pill> : null}
                </View>
              </View>
            );
          })}
        </Screen>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  gap: { height: spacing.md },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  form: { marginBottom: spacing.lg },
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: type.body,
    color: colors.ink,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 60,
    gap: spacing.md,
  },
  rowExpired: {
    borderStartWidth: 3,
    borderStartColor: colors.rust,
    backgroundColor: colors.rustSoft,
  },
  rowMain: { flexShrink: 1, gap: 2 },
  rowEnd: { alignItems: 'flex-end', gap: spacing.xs },
  product: { fontSize: type.body, fontWeight: '600', color: colors.ink },
  // No forced direction: the line mixes an Arabic label with a Latin batch code and a date, and
  // forcing it either way reorders the date's own digits. Bidi resolves it correctly on its own.
  meta: { fontSize: type.caption, color: colors.muted },
  code: { writingDirection: 'ltr', fontWeight: '600' },
  qty: { fontSize: type.heading, fontWeight: '700', color: colors.ink },
});
