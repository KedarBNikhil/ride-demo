import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ScreenShell } from '../../components/ScreenShell';
import { colors, fontFamily, fontSize } from '../../theme';
export function EndRidePlaceholderScreen({ onBack }: { onBack: () => void }) { const { t } = useTranslation(); return <ScreenShell back={onBack} title={t('captain.endRideTitle')}><Text style={styles.text}>{t('captain.endRidePlaceholder')}</Text></ScreenShell>; }
const styles = StyleSheet.create({ text: { color: colors.textSecondary, fontFamily, fontSize: fontSize.lg, lineHeight: 28, textAlign: 'center' } });
