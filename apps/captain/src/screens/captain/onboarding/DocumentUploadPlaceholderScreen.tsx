import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ScreenShell } from '../../../components/ScreenShell';
import { colors, fontFamily, fontSize } from '../../../theme';
export function DocumentUploadPlaceholderScreen({ onBack }: { onBack: () => void }) { const { t } = useTranslation(); return <ScreenShell back={onBack} title={t('captain.documentTitle')}><Text style={styles.emoji}>📄</Text><Text style={styles.text}>{t('captain.documentPlaceholder')}</Text></ScreenShell>; }
const styles = StyleSheet.create({ emoji: { fontSize: 56, textAlign: 'center' }, text: { color: colors.textSecondary, fontFamily, fontSize: fontSize.lg, lineHeight: 29, textAlign: 'center' } });
