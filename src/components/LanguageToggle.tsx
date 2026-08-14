import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '../i18n/createI18n';
import { colors, fontFamily, fontSize, radii } from '../theme';

export function LanguageToggle({ value, onChange }: { value: AppLanguage; onChange: (language: AppLanguage) => void }) {
  const { t } = useTranslation();
  return <View style={styles.row}>{(['te', 'en'] as const).map((language) => <Pressable key={language} onPress={() => onChange(language)} style={[styles.option, value === language && styles.active]}><Text style={[styles.text, value === language && styles.activeText]}>{language === 'te' ? `అ ${t('language.telugu')}` : `A ${t('language.english')}`}</Text></Pressable>)}</View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 8 }, option: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }, active: { backgroundColor: colors.primary, borderColor: colors.primary }, text: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, activeText: { color: colors.textOnPrimary } });
