import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ScreenShell } from '../../components/ScreenShell';
import { colors, fontFamily, fontSize } from '../../theme';
export function StartRidePlaceholderScreen({ onBack }: { onBack: () => void }) { const { t } = useTranslation(); return <ScreenShell back={onBack} title={t('captain.startRideTitle')}><Text style={styles.emoji}>🚕</Text><Text style={styles.text}>{t('captain.startRidePlaceholder')}</Text></ScreenShell>; }
const styles = StyleSheet.create({ emoji: { fontSize: 56, textAlign: 'center' }, text: { color: colors.textSecondary, fontFamily, fontSize: fontSize.lg, lineHeight: 28, textAlign: 'center' } });
