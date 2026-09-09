import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors } from '../theme';

type Props = { titleKey: string; onNext: () => void; onSettings: () => void; isLast?: boolean; onExit?: () => void };

export function PlaceholderScreen({ titleKey, onNext, onSettings, isLast, onExit }: Props) {
  const { t } = useTranslation();
  return <View style={styles.page}>
    <Text style={styles.title}>{t(titleKey)}</Text>
    <Text style={styles.note}>Stage 1 placeholder</Text>
    <View style={styles.actions}>
      <PrimaryButton label={isLast ? t('mode.switch') : t('actions.next')} onPress={isLast ? onExit! : onNext} />
      <PrimaryButton label={t('actions.settings')} onPress={onSettings} secondary />
    </View>
  </View>;
}
const styles = StyleSheet.create({ page: { flex: 1, alignItems: 'center', backgroundColor: colors.bg, justifyContent: 'center', padding: 24 }, title: { color: colors.textPrimary, fontFamily: 'NotoSansTelugu', fontSize: 31, fontWeight: '800', textAlign: 'center' }, note: { color: colors.textSecondary, fontFamily: 'NotoSansTelugu', fontSize: 17, marginTop: 10 }, actions: { alignSelf: 'stretch', gap: 16, marginTop: 32 } });
