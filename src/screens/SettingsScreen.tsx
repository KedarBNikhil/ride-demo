import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '../i18n/createI18n';
import { colors, radii, shadows, fontFamily, fontSize } from '../theme';
import { ScreenShell } from '../components/ScreenShell';

function LangChip({
  symbol,
  name,
  sub,
  value,
  onPress,
  active,
}: {
  symbol: string;
  name: string;
  sub: string;
  value: AppLanguage;
  onPress: (l: AppLanguage) => void;
  active?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={() => onPress(value)}
      onPressIn={() =>
        Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50 }).start()
      }
      onPressOut={() =>
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()
      }
    >
      <Animated.View
        style={[
          styles.chip,
          active && styles.chipActive,
          shadows.soft,
          { transform: [{ scale }] },
        ]}
      >
        <View style={[styles.languageMark, active && styles.languageMarkActive]}>
          <Text style={[styles.languageMarkText, active && styles.languageMarkTextActive]}>{symbol}</Text>
        </View>
        <View style={styles.chipText}>
          <Text style={[styles.chipName, active && styles.chipNameActive]}>{name}</Text>
          <Text style={[styles.chipSub, active && styles.chipSubActive]}>{sub}</Text>
        </View>
        {active && <Text style={styles.chipCheck}>✓</Text>}
      </Animated.View>
    </Pressable>
  );
}

export function SettingsScreen({
  onLanguageChange,
  onBack,
}: {
  onLanguageChange: (language: AppLanguage) => void;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <ScreenShell back={onBack} title={t('screens.settings')}>
      {/* Section: Language */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('language.change')}</Text>
        <View style={styles.chips}>
          <LangChip
            symbol="త"
            name="తెలుగు"
            sub=""
            value="te"
            onPress={onLanguageChange}
            active={i18n.language === 'te'}
          />
          <LangChip
            symbol="E"
            name="English"
            sub=""
            value="en"
            onPress={onLanguageChange}
            active={i18n.language === 'en'}
          />
        </View>
      </View>

      {/* App info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>{t('app.name')}</Text>
        <Text style={styles.infoSub}>{t('app.demoVersion')}</Text>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  chips: { gap: 10 },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  chipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  languageMark: {
    alignItems: 'center',
    backgroundColor: colors.bgAlt,
    borderRadius: radii.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  languageMarkActive: { backgroundColor: colors.primary },
  languageMarkText: { color: colors.accent, fontFamily, fontSize: 21, fontWeight: '900' },
  languageMarkTextActive: { color: colors.textOnPrimary },
  chipText: { flex: 1, gap: 2 },
  chipName: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  chipNameActive: { color: colors.primary },
  chipSub: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm },
  chipSubActive: { color: colors.primaryDark },
  chipCheck: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '800',
  },

  infoCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: 4,
    marginTop: 8,
    padding: 20,
  },
  infoTitle: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  infoSub: {
    color: colors.textMuted,
    fontFamily,
    fontSize: fontSize.sm,
  },
});
