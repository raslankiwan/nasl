import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  editNumberEntry,
  parseNumberEntry,
  type NumberLimits,
  type NumberSelection,
} from '../numberEntry';
import { createThemedStyles, MIN_TOUCH, radius, spacing, type, useTheme } from '../theme';
import { Keypad } from './Keypad';

/** Staged entry keeps an incomplete/invalid draft out of the parent form and its Save action. */
export function NumberEditor({
  label,
  value,
  suffix,
  min,
  max,
  decimals,
  optional,
  onChange,
  onClose,
}: NumberLimits & {
  label: string;
  value: number | null;
  suffix?: string;
  onChange: (value: number | null) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('common');
  const styles = useStyles();
  const { colors } = useTheme();
  const initial = value === null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  const [selection, setSelection] = useState<NumberSelection>({ start: 0, end: initial.length });
  const input = useRef<TextInput>(null);
  const result = parseNumberEntry(draft, { min, max, decimals, optional });
  const error =
    !result.valid && draft.trim() ? t(result.error, { min, max, places: decimals }) : null;
  const submit = () => {
    if (!result.valid) return;
    onChange(result.value);
    onClose();
  };
  const edit = (insert: string) => {
    const next = editNumberEntry(draft, selection, insert);
    setDraft(next.text);
    setSelection(next.selection);
  };
  const clear = () => {
    setDraft('');
    setSelection({ start: 0, end: 0 });
  };

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => input.current?.focus()}
    >
      <View style={styles.backdrop}>
        <View
          style={[styles.dialog, { direction: i18n.dir() }]}
          accessibilityViewIsModal
          accessibilityLabel={label}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="always">
            <Text accessibilityRole="header" style={styles.heading}>
              {label}
            </Text>
            <Text style={styles.hint}>
              {t('numberRange', { min, max })}
              {suffix ? ` · ${suffix}` : ''}
            </Text>
            <View style={[styles.inputRow, error && styles.inputError]}>
              <TextInput
                ref={input}
                accessibilityLabel={label}
                accessibilityHint={t('enterNumber')}
                aria-invalid={Boolean(error)}
                value={draft}
                onChangeText={setDraft}
                selection={selection}
                onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
                selectTextOnFocus
                // Keep the large keypad on touch devices; hardware typing/pasting still works.
                showSoftInputOnFocus={false}
                inputMode="none"
                autoCorrect={false}
                autoCapitalize="none"
                placeholder="—"
                placeholderTextColor={colors.muted}
                maxLength={24}
                returnKeyType="done"
                onSubmitEditing={submit}
                style={styles.input}
              />
              {suffix ? <Text style={styles.unit}>{suffix}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('clearValue')}
                onPress={clear}
                style={styles.clear}
              >
                <Text style={styles.clearText}>{t('clearValue')}</Text>
              </Pressable>
            </View>
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : (
              <Text style={styles.hint}>{t('enterNumber')}</Text>
            )}
            <View style={styles.keypad}>
              <Keypad
                onDigit={edit}
                onBackspace={() => edit('backspace')}
                onClear={clear}
                onDecimal={decimals > 0 ? () => edit('.') : undefined}
              />
            </View>
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
                <Text style={styles.cancelText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!result.valid}
                onPress={submit}
                style={[styles.done, !result.valid && styles.disabled]}
              >
                <Text style={styles.doneText}>{t('done')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = createThemedStyles((colors) => ({
  backdrop: {
    flex: 1,
    padding: spacing.sm,
    backgroundColor: '#00000080',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '92%',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  content: { padding: spacing.lg, gap: spacing.sm },
  heading: { fontSize: type.heading, fontWeight: '700', color: colors.ink },
  hint: { fontSize: type.label, color: colors.muted },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  inputError: { borderColor: colors.rust },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    fontSize: 28,
    color: colors.ink,
    fontWeight: '600',
    textAlign: 'center',
    writingDirection: 'ltr',
  },
  unit: { fontSize: type.label, color: colors.muted },
  clear: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearText: { fontSize: type.label, color: colors.accent },
  error: { fontSize: type.label, color: colors.rust },
  keypad: { marginVertical: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  cancel: {
    flex: 1,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  cancelText: { fontSize: type.body, color: colors.ink, fontWeight: '600' },
  done: {
    flex: 1,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
  },
  doneText: { fontSize: type.body, color: colors.onAccent, fontWeight: '700' },
  disabled: { opacity: 0.4 },
}));
