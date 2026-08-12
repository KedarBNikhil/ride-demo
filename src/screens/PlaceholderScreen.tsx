import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../components/PrimaryButton';

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
const styles = StyleSheet.create({ page: { flex: 1, alignItems: 'center', backgroundColor: '#FFFDF8', justifyContent: 'center', padding: 24 }, title: { color: '#172B26', fontFamily: 'NotoSansTelugu', fontSize: 31, fontWeight: '800', textAlign: 'center' }, note: { color: '#52706A', fontFamily: 'NotoSansTelugu', fontSize: 17, marginTop: 10 }, actions: { alignSelf: 'stretch', gap: 16, marginTop: 32 } });
