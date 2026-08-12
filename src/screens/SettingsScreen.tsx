import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '../i18n/createI18n';
import { colors, radii, shadows, fontFamily, fontSize } from '../theme';
import { ScreenShell } from '../components/ScreenShell';

function LangChip({
  flag,
  name,
  sub,
  value,
  onPress,
  active,
}: {
  flag: string;
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
        <Text style={styles.chipFlag}>{flag}</Text>
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
  const { t } = useTranslation();
  return (
    <ScreenShell back={onBack} title={t('screens.settings')}>
      {/* Section: Language */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('language.change')}</Text>
        <View style={styles.chips}>
          <LangChip
            flag="🇮🇳"
            name="తెలుగు"
            sub="Telugu"
            value="te"
            onPress={onLanguageChange}
          />
          <LangChip
            flag="🔤"
            name="English"
            sub="ఇంగ్లీష్"
            value="en"
            onPress={onLanguageChange}
          />
        </View>
      </View>

      {/* App info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Nandyal Ride</Text>
        <Text style={styles.infoSub}>Demo v1.0 · నంద్యాల రైడ్</Text>
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
  chipFlag: { fontSize: 26 },
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
